//! Upload a recording to an OpenAI-compatible `/audio/transcriptions` endpoint
//! (OpenAI Whisper, Groq, or a local Whisper server). The key never leaves Rust,
//! and neither the audio nor the transcript is logged.

use std::time::Duration;

use serde::Deserialize;

use super::{SttConfig, VoiceError, VoiceErrorKind};

const TIMEOUT: Duration = Duration::from_secs(60);
const BOUNDARY: &str = "----ai-pet-voice-7f3c2a9e";

/// A `multipart/form-data` body with text fields and one file part.
pub fn multipart_body(fields: &[(&str, &str)], file_name: &str, mime: &str, audio: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(audio.len() + 512);
    for (name, value) in fields {
        body.extend_from_slice(
            format!("--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes(),
        );
    }
    body.extend_from_slice(
        format!(
            "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: {mime}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(audio);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    body
}

#[derive(Deserialize)]
struct Transcription {
    text: String,
}

pub async fn transcribe(client: &reqwest::Client, cfg: &SttConfig, audio: Vec<u8>) -> Result<String, VoiceError> {
    let url = crate::ai::join_path(&cfg.base_url, "audio/transcriptions");
    let mut fields: Vec<(&str, &str)> = vec![("model", cfg.model.as_str()), ("response_format", "json")];
    if let Some(lang) = cfg.language.as_deref() {
        fields.push(("language", lang));
    }
    let body = multipart_body(&fields, "speech.m4a", "audio/mp4", &audio);
    let mut req = client
        .post(url)
        .timeout(TIMEOUT)
        .header("Content-Type", format!("multipart/form-data; boundary={BOUNDARY}"))
        .body(body);
    if let Some(key) = &cfg.api_key {
        req = req.bearer_auth(key);
    }
    let started = std::time::Instant::now();
    let resp = req.send().await.map_err(|e| {
        log::warn!("Transcription request failed (timeout={}, connect={})", e.is_timeout(), e.is_connect());
        VoiceError::new(VoiceErrorKind::Network, "I couldn't reach the speech-to-text service.")
    })?;
    let status = resp.status().as_u16();
    if !resp.status().is_success() {
        log::warn!("Transcription failed (HTTP {status})");
        return Err(VoiceError::new(
            match status {
                401 | 403 => VoiceErrorKind::NotConfigured,
                _ => VoiceErrorKind::Failed,
            },
            match status {
                401 | 403 => "The speech-to-text key was rejected. Check Settings → Voice.",
                404 => "That speech-to-text endpoint or model wasn't found.",
                413 => "That recording was too long.",
                429 => "Speech-to-text is rate-limited. Try again in a moment.",
                _ => "The speech-to-text service had a problem.",
            },
        ));
    }
    let parsed: Transcription = resp.json().await.map_err(|_| {
        log::warn!("Transcription response was not the expected JSON");
        VoiceError::new(VoiceErrorKind::Failed, "The speech-to-text service sent back something odd.")
    })?;
    log::info!("Transcription finished in {} ms", started.elapsed().as_millis());
    Ok(parsed.text.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_well_formed_multipart_body() {
        let body = multipart_body(&[("model", "whisper-1"), ("language", "bn")], "speech.m4a", "audio/mp4", b"AUDIO");
        let text = String::from_utf8(body).unwrap();
        assert!(text.starts_with(&format!("--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nwhisper-1\r\n")));
        assert!(text.contains("name=\"language\"\r\n\r\nbn\r\n"));
        assert!(text.contains("filename=\"speech.m4a\"\r\nContent-Type: audio/mp4\r\n\r\nAUDIO\r\n"));
        assert!(text.ends_with(&format!("--{BOUNDARY}--\r\n")));
    }
}
