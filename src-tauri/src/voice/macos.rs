//! macOS side of voice input: permissions (microphone, speech recognition), live
//! recognition with `SFSpeechRecognizer` + `AVAudioEngine`, and short recordings with
//! `AVAudioRecorder` for Whisper.
//!
//! The Objective-C objects of a session live in a thread-local on the main thread and are
//! only touched there (the recognizer also delivers its results on the main queue).

use std::cell::RefCell;
use std::path::PathBuf;
use std::ptr::NonNull;
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool};
use objc2::AnyThread;
use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};
use objc2_avf_audio::{
    AVAudioEngine, AVAudioPCMBuffer, AVAudioRecorder, AVAudioTime, AVEncoderAudioQualityKey, AVFormatIDKey,
    AVNumberOfChannelsKey, AVSampleRateKey,
};
use objc2_foundation::{NSDictionary, NSError, NSLocale, NSNumber, NSString, NSURL};
use objc2_speech::{
    SFSpeechAudioBufferRecognitionRequest, SFSpeechRecognitionResult, SFSpeechRecognitionTask, SFSpeechRecognizer,
    SFSpeechRecognizerAuthorizationStatus,
};
use tauri::ipc::Channel;
use tauri::AppHandle;

use super::{Engine, Stopped, VoiceError, VoiceErrorKind, VoiceEvent, MAX_RECORDING};

/// kAudioFormatMPEG4AAC ('aac ').
const FORMAT_AAC: u32 = 0x6161_6320;
/// AVAudioQualityHigh.
const QUALITY_HIGH: i64 = 0x60;
/// How long to wait for the recognizer's final result after the mic closes.
const FINAL_GRACE: Duration = Duration::from_secs(4);

type TapBlock = RcBlock<dyn Fn(NonNull<AVAudioPCMBuffer>, NonNull<AVAudioTime>)>;
type ResultBlock = RcBlock<dyn Fn(*mut SFSpeechRecognitionResult, *mut NSError)>;

enum Kind {
    Live {
        engine: Retained<AVAudioEngine>,
        request: Retained<SFSpeechAudioBufferRecognitionRequest>,
        task: Retained<SFSpeechRecognitionTask>,
        _recognizer: Retained<SFSpeechRecognizer>,
        _tap: TapBlock,
        _handler: ResultBlock,
        tapped: bool,
    },
    Recording {
        recorder: Retained<AVAudioRecorder>,
        path: PathBuf,
    },
}

struct Session {
    id: u64,
    kind: Kind,
    channel: Channel<VoiceEvent>,
    last_text: String,
    finishing: bool,
}

thread_local! {
    static SESSION: RefCell<Option<Session>> = const { RefCell::new(None) };
}

/// Run `f` on the main thread and wait for its result.
async fn on_main<R: Send + 'static>(app: &AppHandle, f: impl FnOnce() -> R + Send + 'static) -> Option<R> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .ok()?;
    rx.await.ok()
}

fn permission_error(what: &str, pane: &str) -> VoiceError {
    VoiceError::new(
        VoiceErrorKind::Permission,
        format!("I can't use {what}. Allow AI Pet in System Settings → Privacy & Security → {pane}, then try again."),
    )
}

/// Ask for microphone (and, for the Apple engine, speech recognition) access, waiting
/// for the user's answer the first time. Blocking; call off the main thread.
fn ensure_permissions(speech: bool) -> Result<(), VoiceError> {
    // SAFETY: plain class-method calls; the completion blocks only send on a channel.
    unsafe {
        let audio = AVMediaTypeAudio.ok_or_else(|| VoiceError::new(VoiceErrorKind::Failed, "No audio support."))?;
        match AVCaptureDevice::authorizationStatusForMediaType(audio) {
            AVAuthorizationStatus::Authorized => {}
            AVAuthorizationStatus::NotDetermined => {
                let (tx, rx) = mpsc::channel();
                let block = RcBlock::new(move |granted: Bool| {
                    let _ = tx.send(granted.as_bool());
                });
                AVCaptureDevice::requestAccessForMediaType_completionHandler(audio, &block);
                if !rx.recv_timeout(Duration::from_secs(120)).unwrap_or(false) {
                    return Err(permission_error("the microphone", "Microphone"));
                }
            }
            _ => return Err(permission_error("the microphone", "Microphone")),
        }
        if speech {
            match SFSpeechRecognizer::authorizationStatus() {
                SFSpeechRecognizerAuthorizationStatus::Authorized => {}
                SFSpeechRecognizerAuthorizationStatus::NotDetermined => {
                    let (tx, rx) = mpsc::channel();
                    let block = RcBlock::new(move |status: SFSpeechRecognizerAuthorizationStatus| {
                        let _ = tx.send(status == SFSpeechRecognizerAuthorizationStatus::Authorized);
                    });
                    SFSpeechRecognizer::requestAuthorization(&block);
                    if !rx.recv_timeout(Duration::from_secs(120)).unwrap_or(false) {
                        return Err(permission_error("speech recognition", "Speech Recognition"));
                    }
                }
                _ => return Err(permission_error("speech recognition", "Speech Recognition")),
            }
        }
    }
    Ok(())
}

pub async fn start(
    app: &AppHandle,
    id: u64,
    engine: Engine,
    language: String,
    channel: Channel<VoiceEvent>,
    continuous: bool,
) -> Result<(), VoiceError> {
    let speech = engine == Engine::Apple;
    tauri::async_runtime::spawn_blocking(move || ensure_permissions(speech))
        .await
        .map_err(|_| VoiceError::new(VoiceErrorKind::Failed, "Voice input failed to start."))??;

    let started = on_main(app, move || match engine {
        Engine::Apple => start_live(id, &language, channel, continuous),
        Engine::Whisper => start_recording(id, channel),
    })
    .await
    .unwrap_or_else(|| Err(VoiceError::new(VoiceErrorKind::Failed, "Voice input failed to start.")));
    if started.is_ok() && engine == Engine::Apple {
        // Safety net: never keep the mic open longer than the maximum.
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(MAX_RECORDING).await;
            let still_running = on_main(&app, move || current_id() == Some(id)).await.unwrap_or(false);
            if still_running {
                let _ = stop(&app).await;
            }
        });
    }
    started
}

fn current_id() -> Option<u64> {
    SESSION.with(|s| s.try_borrow().ok().and_then(|s| s.as_ref().map(|x| x.id)))
}

fn start_live(id: u64, language: &str, channel: Channel<VoiceEvent>, continuous: bool) -> Result<(), VoiceError> {
    // SAFETY: called on the main thread; every object is created and used there, except
    // the tap block, which only appends buffers to the request (Apple's documented pattern).
    unsafe {
        let recognizer = if language.is_empty() {
            SFSpeechRecognizer::init(SFSpeechRecognizer::alloc())
        } else {
            let locale = NSLocale::localeWithLocaleIdentifier(&NSString::from_str(language));
            SFSpeechRecognizer::initWithLocale(SFSpeechRecognizer::alloc(), &locale)
        }
        .ok_or_else(|| {
            VoiceError::new(
                VoiceErrorKind::Unavailable,
                "macOS can't recognise speech in that language. Pick another in Settings → Voice, or use Whisper.",
            )
        })?;
        if !recognizer.isAvailable() {
            return Err(VoiceError::new(
                VoiceErrorKind::Unavailable,
                "Speech recognition isn't available right now (it may need an internet connection).",
            ));
        }

        let request = SFSpeechAudioBufferRecognitionRequest::new();
        request.setShouldReportPartialResults(true);
        request.setAddsPunctuation(true);
        if recognizer.supportsOnDeviceRecognition() {
            // Keep the audio on this Mac when it can do the work itself.
            request.setRequiresOnDeviceRecognition(true);
        } else if continuous {
            // Never stream the room to a server just to wait for her name.
            return Err(VoiceError::new(
                VoiceErrorKind::Unavailable,
                "Your Mac can't recognise this language on-device, so I won't listen for my name all the time. \
                 Pick English (or another supported language) in Settings → Voice.",
            ));
        }

        let engine = AVAudioEngine::new();
        let input = engine.inputNode();
        let format = input.outputFormatForBus(0);
        if format.sampleRate() <= 0.0 || format.channelCount() == 0 {
            return Err(VoiceError::new(VoiceErrorKind::Unavailable, "I can't find a microphone."));
        }
        let sink = request.clone();
        let tap: TapBlock = RcBlock::new(move |buffer: NonNull<AVAudioPCMBuffer>, _when: NonNull<AVAudioTime>| {
            sink.appendAudioPCMBuffer(buffer.as_ref());
        });
        input.installTapOnBus_bufferSize_format_block(0, 1024, Some(&format), RcBlock::as_ptr(&tap));
        engine.prepare();
        if let Err(e) = engine.startAndReturnError() {
            input.removeTapOnBus(0);
            log::warn!("Audio engine failed to start (code {})", e.code());
            return Err(VoiceError::new(VoiceErrorKind::Failed, "I couldn't open the microphone."));
        }

        let handler: ResultBlock = RcBlock::new(move |result: *mut SFSpeechRecognitionResult, error: *mut NSError| {
            on_result(id, result, error);
        });
        let task = recognizer.recognitionTaskWithRequest_resultHandler(&request, &handler);

        SESSION.with(|s| {
            *s.borrow_mut() = Some(Session {
                id,
                kind: Kind::Live {
                    engine,
                    request,
                    task,
                    _recognizer: recognizer,
                    _tap: tap,
                    _handler: handler,
                    tapped: true,
                },
                channel,
                last_text: String::new(),
                finishing: false,
            });
        });
    }
    Ok(())
}

/// Recognizer callback (main queue): partial and final transcripts, or an error.
fn on_result(id: u64, result: *mut SFSpeechRecognitionResult, error: *mut NSError) {
    enum Outcome {
        Partial(Channel<VoiceEvent>, String),
        Final(Channel<VoiceEvent>, String),
        Failed(Channel<VoiceEvent>, VoiceError),
        Ignore,
    }
    let outcome = SESSION.with(|cell| {
        let Ok(mut guard) = cell.try_borrow_mut() else { return Outcome::Ignore };
        let Some(session) = guard.as_mut().filter(|s| s.id == id) else { return Outcome::Ignore };
        // SAFETY: the pointers are valid for the duration of the callback.
        unsafe {
            if let Some(result) = result.as_ref() {
                let text = result.bestTranscription().formattedString().to_string();
                session.last_text = text.clone();
                if result.isFinal() {
                    return Outcome::Final(session.channel.clone(), text);
                }
                return Outcome::Partial(session.channel.clone(), text);
            }
            if let Some(err) = error.as_ref() {
                if session.finishing {
                    // "No speech detected" and friends after the mic closed: use what we have.
                    return Outcome::Final(session.channel.clone(), session.last_text.clone());
                }
                log::warn!("Speech recognition error (code {})", err.code());
                return Outcome::Failed(
                    session.channel.clone(),
                    VoiceError::new(VoiceErrorKind::Failed, "Speech recognition stopped unexpectedly."),
                );
            }
        }
        Outcome::Ignore
    });
    match outcome {
        Outcome::Partial(channel, text) => {
            let _ = channel.send(VoiceEvent::Partial { text });
        }
        Outcome::Final(channel, text) => {
            end_session(id);
            let _ = channel.send(VoiceEvent::Final { text });
        }
        Outcome::Failed(channel, e) => {
            end_session(id);
            let _ = channel.send(e.event());
        }
        Outcome::Ignore => {}
    }
}

fn start_recording(id: u64, channel: Channel<VoiceEvent>) -> Result<(), VoiceError> {
    let path = std::env::temp_dir().join(format!("ai-pet-voice-{}-{id}.m4a", std::process::id()));
    let failed = || VoiceError::new(VoiceErrorKind::Failed, "I couldn't start recording.");
    // SAFETY: main thread; the settings keys are framework constants.
    unsafe {
        let url = NSURL::from_file_path(&path).ok_or_else(failed)?;
        let (Some(format_key), Some(rate_key), Some(channels_key), Some(quality_key)) =
            (AVFormatIDKey, AVSampleRateKey, AVNumberOfChannelsKey, AVEncoderAudioQualityKey)
        else {
            return Err(failed());
        };
        let format = NSNumber::new_u32(FORMAT_AAC);
        let rate = NSNumber::new_f64(16_000.0);
        let channels = NSNumber::new_u32(1);
        let quality = NSNumber::new_i64(QUALITY_HIGH);
        let values: [&AnyObject; 4] = [format.as_ref(), rate.as_ref(), channels.as_ref(), quality.as_ref()];
        let settings = NSDictionary::from_slices(&[format_key, rate_key, channels_key, quality_key], &values);
        let recorder = AVAudioRecorder::initWithURL_settings_error(AVAudioRecorder::alloc(), &url, &settings)
            .map_err(|e| {
                log::warn!("Recorder setup failed (code {})", e.code());
                failed()
            })?;
        recorder.prepareToRecord();
        if !recorder.recordForDuration(MAX_RECORDING.as_secs_f64()) {
            return Err(VoiceError::new(VoiceErrorKind::Failed, "I couldn't open the microphone."));
        }
        SESSION.with(|s| {
            *s.borrow_mut() = Some(Session {
                id,
                kind: Kind::Recording { recorder, path },
                channel,
                last_text: String::new(),
                finishing: false,
            });
        });
    }
    Ok(())
}

/// Stop the audio side of the session (main thread). Keeps a live session around until
/// the recognizer's final result arrives; hands a recording back for upload.
fn stop_on_main() -> Stopped {
    SESSION.with(|cell| {
        let mut guard = cell.borrow_mut();
        let recording = match guard.as_ref() {
            None => return Stopped::Idle,
            Some(session) => matches!(session.kind, Kind::Recording { .. }),
        };
        if recording {
            let Some(Session { id, kind: Kind::Recording { recorder, path }, channel, .. }) = guard.take() else {
                return Stopped::Idle;
            };
            // SAFETY: main thread; stopping closes the file.
            unsafe { recorder.stop() };
            return Stopped::Recorded { id, path, channel };
        }
        let Some(session) = guard.as_mut() else { return Stopped::Idle };
        if let Kind::Live { engine, request, tapped, .. } = &mut session.kind {
            // SAFETY: main thread.
            unsafe {
                engine.stop();
                if *tapped {
                    engine.inputNode().removeTapOnBus(0);
                    *tapped = false;
                }
                request.endAudio();
            }
        }
        session.finishing = true;
        Stopped::Streaming
    })
}

pub async fn stop(app: &AppHandle) -> Stopped {
    let stopped = on_main(app, stop_on_main).await.unwrap_or(Stopped::Idle);
    if matches!(stopped, Stopped::Streaming) {
        // If the recognizer never sends a final result, finish with the last partial.
        let app = app.clone();
        let id = on_main(&app, current_id).await.flatten();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(FINAL_GRACE).await;
            let _ = on_main(&app, move || {
                let Some(id) = id else { return };
                let pending = SESSION.with(|cell| {
                    let guard = cell.borrow();
                    guard
                        .as_ref()
                        .filter(|s| s.id == id && s.finishing)
                        .map(|s| (s.channel.clone(), s.last_text.clone()))
                });
                if let Some((channel, text)) = pending {
                    end_session(id);
                    let _ = channel.send(VoiceEvent::Final { text });
                }
            })
            .await;
        });
    }
    stopped
}

/// Tear down a session's native objects (main thread).
fn end_session(id: u64) {
    let session = SESSION.with(|cell| {
        let mut guard = cell.try_borrow_mut().ok()?;
        if guard.as_ref().map(|s| s.id) == Some(id) {
            guard.take()
        } else {
            None
        }
    });
    if let Some(session) = session {
        teardown(session);
    }
}

fn teardown(session: Session) {
    // SAFETY: main thread.
    unsafe {
        match session.kind {
            Kind::Live { engine, request, task, tapped, .. } => {
                if engine.isRunning() {
                    engine.stop();
                }
                if tapped {
                    engine.inputNode().removeTapOnBus(0);
                }
                request.endAudio();
                if !task.isFinishing() && !task.isCancelled() {
                    task.cancel();
                }
            }
            Kind::Recording { recorder, path } => {
                recorder.stop();
                recorder.deleteRecording();
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

pub fn cancel(app: &AppHandle) {
    let _ = app.run_on_main_thread(|| {
        let session = SESSION.with(|cell| cell.try_borrow_mut().ok().and_then(|mut s| s.take()));
        if let Some(session) = session {
            log::info!("Voice input cancelled");
            teardown(session);
        }
    });
}
