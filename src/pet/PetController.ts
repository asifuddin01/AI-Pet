import { Menu } from "@tauri-apps/api/menu";

import { friendlyError, isCancellation, needsSettings, type ChatMessage } from "../ai/AIProvider";
import { planTranslation, speechLangFor } from "../ai/language";
import { NativeAIProvider } from "../ai/NativeAIProvider";
import { HISTORY_LIMIT } from "../ai/PromptBuilder";
import type { PetTask, TaskContext } from "../ai/tasks";
import { TaskRunner } from "../ai/TaskRunner";
import { ChatBubble, type BubbleModel, type TranscriptLine } from "../components/ChatBubble";
import { Pet } from "../components/Pet";
import type { MenuButton } from "../components/TaskMenu";
import { ClipboardService } from "../services/ClipboardService";
import { log, native, on } from "../services/native";
import { SelectedTextService } from "../services/SelectedTextService";
import { SettingsService } from "../services/SettingsService";
import { cleanForSpeech, SentenceStreamer } from "../services/speech";
import { TTSService } from "../services/TTSService";
import type { AppStatus, HotkeyEvent, Point, ScreenInfo, SelectedTextEvent, Settings } from "../types";
import { formatShortcut } from "../util/shortcut";
import { AnimationController } from "./AnimationController";
import {
  BUBBLE_WIDTH,
  clampPet,
  compactFrame,
  defaultPetPosition,
  expandedLayout,
  petBoxSize,
  petCenter,
  petHitRect,
  placeNearCursor,
  primaryScreen,
  screenForPoint,
  type BubbleSide,
  type ExpandedLayout,
} from "./PetPosition";
import { PetStateMachine } from "./PetState";
import { RoamingController } from "./RoamingController";

const ROAM_RESUME_MS = 4000;
const SLEEP_AFTER_MS = 12 * 60_000;
const NAP_MIN_MS = 4 * 60_000;
const NAP_MAX_MS = 9 * 60_000;
const ERROR_SHOW_MS = 2500;
const DOUBLE_CLICK_MS = 260;
const DRAG_THRESHOLD = 4;
const POSITION_SAVE_MS = 2 * 60_000;
/** Rough bubble height used to decide placement before the content is measured. */
const BUBBLE_ESTIMATE = 260;

type View =
  | "none"
  | "onboarding"
  | "permission"
  | "capturing"
  | "tasks"
  | "no-selection"
  | "result"
  | "chat"
  | "quick"
  | "notice";

interface Subject {
  text: string;
  truncated: boolean;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  origin: Promise<Point>;
  moved: boolean;
  target: Point | null;
}

const FALLBACK_STATUS: AppStatus = {
  platform: "macos",
  version: "",
  accessibilityTrusted: false,
  hotkeyWarnings: [],
  aiConfigured: false,
  hasApiKey: false,
};

/**
 * Orchestrates the pet window: state machine, animation, roaming, the hotkey flow,
 * the speech bubble, AI tasks (one at a time, cancellable), speech and dragging.
 *
 * Responsiveness rule: the pet always shows first; capturing text and AI work
 * happen afterwards and never block the UI.
 */
export class PetController {
  private readonly fsm = new PetStateMachine();
  private readonly pet: Pet;
  private readonly bubble: ChatBubble;
  private readonly anim: AnimationController;
  private readonly roaming: RoamingController;
  private readonly tts: TTSService;
  private readonly runner: TaskRunner;
  private readonly selection = new SelectedTextService();

  private screens: ScreenInfo[] = [];
  private petPos: Point = { x: 0, y: 0 };
  private size: number;
  private expanded: ExpandedLayout | null = null;
  private preferSide: BubbleSide = "above";
  private view: View = "none";

  private subject: Subject | null = null;
  private transcript: TranscriptLine[] = [];
  private history: ChatMessage[] = [];
  private lastAnswer = "";
  private lastTask: { task: PetTask; context: TaskContext } | null = null;
  private request: AbortController | null = null;

  private motionWaiters = new Map<number, (arrived: boolean) => void>();
  private drag: DragState | null = null;
  private dragInFlight = false;
  private clickTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  private napTimer: ReturnType<typeof setTimeout> | undefined;
  private errorTimer: ReturnType<typeof setTimeout> | undefined;
  private refitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastInteraction = Date.now();
  private lastPositionSave = 0;
  private enabling: Promise<void> | null = null;
  private warnedHotkeys = false;
  /** Hotkey press currently being handled, and its capture if it arrived early. */
  private activeSeq = 0;
  private pendingCapture: SelectedTextEvent | null = null;
  private awaitingCapture = false;
  /** Bumped whenever the pet is placed explicitly, so late motion reports can't undo it. */
  private placementEpoch = 0;
  private onboardingStep = 0;

  static async create(root: HTMLElement): Promise<PetController> {
    const settings = await SettingsService.load();
    const status = await native.getAppStatus().catch(() => FALLBACK_STATUS);
    const controller = new PetController(root, settings, status);
    await controller.init();
    return controller;
  }

  private constructor(
    private readonly root: HTMLElement,
    private readonly settings: SettingsService,
    private status: AppStatus,
  ) {
    this.size = petBoxSize(settings.get().petSize);
    this.pet = new Pet(root);
    this.bubble = new ChatBubble(root, {
      onTask: (id) => void this.onTask(id),
      onAction: (id) => void this.onAction(id),
      onSubmit: (text) => void this.onSubmit(text),
      onClose: () => void this.closeBubble(),
    });
    this.anim = new AnimationController(this.pet);
    this.fsm.onChange((state) => {
      this.anim.apply(state);
      root.dataset.state = state.toLowerCase();
    });

    this.tts = new TTSService(() => ({ voice: this.settings.get().voice, rate: this.settings.get().speechRate }));
    this.tts.onSpeakingChange((speaking) => this.onSpeakingChange(speaking));

    const provider = new NativeAIProvider(() => (this.settings.get().requestTimeoutSecs + 15) * 1000);
    this.runner = new TaskRunner(provider, () => ({
      translateTarget: this.settings.get().translateTarget,
      autoSecondLanguage: this.settings.get().autoSecondLanguage,
    }));

    this.roaming = new RoamingController({
      getScreens: () => this.refreshScreens(),
      getPosition: () => this.petPos,
      petSize: () => this.size,
      options: () => {
        const s = this.settings.get();
        return { roamAllDisplays: s.roamAllDisplays, roamArea: s.roamArea, animationSpeed: s.animationSpeed };
      },
      moveTo: (target, ms) => this.moveTo(target, ms),
      stopMotion: () => this.stopMotion(),
      onWalkStart: (direction) => {
        this.pet.setFacing(direction);
        this.fsm.transition("WALKING");
      },
      onWalkEnd: (position) => {
        this.petPos = position;
        if (this.fsm.is("WALKING")) this.fsm.transition("IDLE");
        this.maybeSavePosition();
      },
    });
  }

  // ------------------------------------------------------------------ lifecycle

  private async init(): Promise<void> {
    this.applyAppearance();
    await Promise.all([
      this.selection.listen({
        onActivate: (e) => void this.onHotkey(e),
        onCaptured: (e) => void this.onCaptured(e),
      }),
      on<boolean>("pet-toggle", (enabled) => void (enabled ? this.enable() : this.disable())),
      on<{ id: number }>("pet-arrived", ({ id }) => this.settleMotion(id, true)),
      on("open-chat", () => void this.openChat()),
    ]);
    this.settings.onChange((next, prev) => this.onSettingsChanged(next, prev));
    this.bindPointer();
    this.bindKeys();
    // A cheap once-a-minute check that lets an ignored pet doze off.
    setInterval(() => this.checkSleep(), 60_000);
    if (this.settings.get().petEnabled) await this.enable();
  }

  async enable(): Promise<void> {
    if (!this.fsm.is("OFF")) return;
    if (this.enabling) return this.enabling;
    this.enabling = (async () => {
      await this.refreshScreens();
      const s = this.settings.get();
      const saved = s.lastPosition;
      const savedScreen = saved ? screenForPoint(petCenter(saved, this.size), this.screens) : undefined;
      const primary = primaryScreen(this.screens);
      if (saved && savedScreen) this.petPos = clampPet(saved, this.size, savedScreen.visibleFrame);
      else if (primary) this.petPos = defaultPetPosition(primary, this.size);
      await this.applyCompact();
      await native.showPet();
      this.fsm.transition("IDLE");
      this.touch();
      log("info", "Pet enabled");
      if (!s.firstRunCompleted) {
        await this.showOnboarding(0);
      } else if (this.status.hotkeyWarnings.length && !this.warnedHotkeys) {
        this.warnedHotkeys = true;
        await this.showNotice("Shortcut problem", this.status.hotkeyWarnings.join("\n"), true);
      } else {
        this.anim.gesture("wave");
        this.scheduleRoamResume(1500);
      }
    })();
    try {
      await this.enabling;
    } finally {
      this.enabling = null;
    }
  }

  async disable(): Promise<void> {
    if (this.fsm.is("OFF")) return;
    this.cancelRequest();
    this.tts.stop();
    this.stopRoaming();
    clearTimeout(this.resumeTimer);
    clearTimeout(this.napTimer);
    clearTimeout(this.errorTimer);
    this.bubble.hide();
    this.expanded = null;
    this.view = "none";
    this.fsm.transition("OFF");
    await native.hidePet();
    await this.savePosition();
    log("info", "Pet disabled");
  }

  // ------------------------------------------------------------------ hotkey flow

  private async onHotkey(e: HotkeyEvent): Promise<void> {
    if (this.fsm.is("OFF")) return;
    // The capture can arrive before the bubble is up; remember which press we're on.
    this.activeSeq = e.seq;
    this.pendingCapture = null;
    this.awaitingCapture = false;
    this.touch();
    // Pressing again while open = refresh: cancel, move, replace the bubble (§24, §69).
    this.cancelRequest();
    this.tts.stop();
    this.stopRoaming();
    await this.refreshScreens();
    const screen = screenForPoint(e.cursor, this.screens) ?? primaryScreen(this.screens);
    if (!screen) return;
    const { pet, side } = placeNearCursor(e.cursor, this.size, screen.visibleFrame, BUBBLE_ESTIMATE);
    this.placementEpoch++;
    this.petPos = pet;
    this.preferSide = side;
    this.resetConversation();
    this.fsm.transition("INTERACTING");
    await this.showBubble({ title: "Let me see…", text: "", textState: "thinking" }, "capturing");
    await native.showPet();
    this.anim.gesture("hop");
    if (e.seq !== this.activeSeq) return; // a newer press took over
    this.awaitingCapture = true;
    if (this.pendingCapture) await this.consumeCapture();
  }

  private async onCaptured(e: SelectedTextEvent): Promise<void> {
    if (e.seq !== this.activeSeq) return;
    this.pendingCapture = e;
    if (this.awaitingCapture) await this.consumeCapture();
  }

  private async consumeCapture(): Promise<void> {
    const e = this.pendingCapture;
    this.pendingCapture = null;
    this.awaitingCapture = false;
    if (!e || this.view !== "capturing") return;
    if (e.text) {
      this.subject = { text: e.text, truncated: e.truncated };
      await this.showTaskMenu();
    } else if (e.permissionMissing) {
      await this.showPermission("hotkey");
    } else if (e.source === "unsupported") {
      await this.openChat();
    } else {
      await this.showNoSelection();
    }
    await this.takeFocus();
  }

  // ------------------------------------------------------------------ views

  private async showTaskMenu(): Promise<void> {
    if (!this.subject) return this.showNoSelection();
    await this.showBubble(
      {
        title: "I found some text!",
        quote: this.subject,
        tasks: this.taskButtons(),
        input: { placeholder: "Ask me anything about it…" },
      },
      "tasks",
    );
  }

  private async showNoSelection(): Promise<void> {
    await this.showBubble(
      {
        title: "I couldn't find selected text.",
        text: "Type or paste something for me.",
        tasks: this.taskButtons(),
        input: { placeholder: "Type or paste text…" },
        hint: "Pick a task to use your text, or press Enter to chat.",
      },
      "no-selection",
    );
  }

  private async showQuickMenu(): Promise<void> {
    const roaming = this.settings.get().roaming;
    await this.showBubble(
      {
        title: "Hi there! What's up?",
        tasks: [
          { id: "quick-chat", label: "Chat", icon: "💬" },
          { id: "quick-translate-clipboard", label: "Translate clipboard", icon: "🌐" },
          { id: "quick-settings", label: "Settings", icon: "⚙️" },
          { id: "quick-roam", label: roaming ? "Pause roaming" : "Resume roaming", icon: roaming ? "⏸" : "▶️" },
        ],
      },
      "quick",
    );
  }

  async openChat(): Promise<void> {
    if (this.enabling) await this.enabling;
    if (this.fsm.is("OFF")) return;
    this.touch();
    this.stopRoaming();
    this.fsm.transition("INTERACTING");
    await this.showBubble(this.chatModel(), "chat");
    await this.takeFocus();
  }

  private chatModel(): BubbleModel {
    return {
      title: this.subject ? "Ask me about it" : "Hey! What can I help with?",
      quote: this.subject ?? undefined,
      transcript: this.transcript,
      input: { placeholder: this.subject ? "Ask about the selected text…" : "Ask me something…" },
    };
  }

  private async showPermission(from: "hotkey" | "onboarding"): Promise<void> {
    const prompted = this.settings.get().accessibilityPrompted;
    await this.showBubble(
      {
        title: "Enable selected-text access?",
        text:
          `This permission allows me to read text you have selected so I can translate, explain, define, ` +
          `or process it when you press ${formatShortcut(this.settings.get().hotkey)}. ` +
          `I don't continuously read your screen.`,
        actions: [
          { id: "grant-access", label: prompted ? "Open System Settings" : "Enable access", primary: true },
          from === "onboarding" ? { id: "onboarding-next", label: "Not now" } : { id: "chat", label: "Just chat" },
        ],
        hint: prompted ? "Turn on AI Pet in Privacy & Security → Accessibility, then try again." : undefined,
      },
      from === "onboarding" ? "onboarding" : "permission",
    );
  }

  private async showNotice(title: string, text: string, settingsButton = false): Promise<void> {
    this.fsm.transition("INTERACTING");
    await this.showBubble(
      {
        title,
        text,
        actions: settingsButton
          ? [
              { id: "open-settings", label: "Open Settings", primary: true },
              { id: "dismiss", label: "OK" },
            ]
          : [{ id: "dismiss", label: "OK" }],
      },
      "notice",
    );
  }

  private async showOnboarding(step: number): Promise<void> {
    this.fsm.transition("INTERACTING");
    const key = formatShortcut(this.settings.get().hotkey);
    if (step === 0) {
      this.onboardingStep = 0;
      await this.showBubble(
        {
          title: "Hi! I'm your desktop pet.",
          text:
            "I can:\n- Chat with you\n- Translate selected text\n- Explain words\n- Summarize text\n- Speak responses\n\n" +
            `Press **${key}** anytime.`,
          actions: [{ id: "onboarding-next", label: "Nice to meet you!", primary: true }],
        },
        "onboarding",
      );
      this.anim.gesture("wave");
      return;
    }
    if (step === 1) {
      this.status = await native.getAppStatus().catch(() => this.status);
      if (this.status.platform !== "macos" || this.status.accessibilityTrusted) return this.showOnboarding(2);
      this.onboardingStep = 1;
      return this.showPermission("onboarding");
    }
    this.status = await native.getAppStatus().catch(() => this.status);
    if (this.status.aiConfigured) return this.finishOnboarding();
    this.onboardingStep = 2;
    await this.showBubble(
      {
        title: "Connect your AI provider",
        text:
          "Chat and text tasks need an AI provider — OpenAI, Anthropic, a local Ollama model and more. " +
          "I'll still hang out on your desktop without one!",
        actions: [
          { id: "onboarding-settings", label: "Open Settings", primary: true },
          { id: "onboarding-done", label: "Later" },
        ],
      },
      "onboarding",
    );
  }

  private async finishOnboarding(): Promise<void> {
    await this.settings.update({ firstRunCompleted: true });
    await this.closeBubble();
  }

  private taskButtons(): MenuButton[] {
    return this.runner.menuTasks().map((h) => ({ id: h.id, label: h.label, icon: h.icon }));
  }

  // ------------------------------------------------------------------ input handlers

  private async onTask(id: string): Promise<void> {
    this.touch();
    switch (id) {
      case "quick-chat":
        return this.openChat();
      case "quick-translate-clipboard": {
        const text = await ClipboardService.readText();
        if (!text) return this.showNotice("Nothing to translate", "Your clipboard doesn't have any text right now.");
        this.subject = { text, truncated: false };
        return this.runTask("translate", { clipboardText: text });
      }
      case "quick-settings":
        await this.closeBubble();
        return native.openSettingsWindow();
      case "quick-roam": {
        const roaming = !this.settings.get().roaming;
        await this.settings.update({ roaming });
        return this.closeBubble();
      }
    }
    // A task button: work on the selection, or on whatever the user typed/pasted.
    if (!this.subject) {
      const typed = this.bubble.inputValue.trim();
      if (!typed) {
        this.bubble.setHint("Paste some text first, then pick a task.");
        this.bubble.focusInput();
        return;
      }
      this.subject = { text: typed, truncated: false };
    }
    await this.runTask(id as PetTask, { selectedText: this.subject.text });
  }

  private async onSubmit(text: string): Promise<void> {
    this.touch();
    await this.sendChat(text);
  }

  private async onAction(id: string): Promise<void> {
    this.touch();
    switch (id) {
      case "copy": {
        const ok = await ClipboardService.writeText(this.lastAnswer);
        this.bubble.setHint(ok ? "Copied!" : "I couldn't copy that.");
        if (ok) this.anim.gesture("happy");
        return;
      }
      case "speak":
        this.tts.stop();
        this.tts.speak(cleanForSpeech(this.lastAnswer), speechLangFor(this.lastAnswer));
        return;
      case "stop-speaking":
        this.tts.stop();
        return;
      case "back":
        this.cancelRequest();
        this.tts.stop();
        this.fsm.transition("INTERACTING");
        return this.subject ? this.showTaskMenu() : this.openChat();
      case "retry":
        if (this.lastTask) return this.runTask(this.lastTask.task, this.lastTask.context);
        return;
      case "open-settings":
        await this.closeBubble();
        return native.openSettingsWindow();
      case "grant-access":
        return this.grantAccess();
      case "chat":
        return this.openChat();
      case "onboarding-next":
        return this.showOnboarding(this.view === "onboarding" && this.onboardingStep >= 1 ? 2 : 1);
      case "onboarding-settings":
        await native.openSettingsWindow();
        return this.finishOnboarding();
      case "onboarding-done":
      case "dismiss":
        if (!this.settings.get().firstRunCompleted) return this.finishOnboarding();
        return this.closeBubble();
    }
  }

  private async grantAccess(): Promise<void> {
    const prompted = this.settings.get().accessibilityPrompted;
    try {
      // First time: the system prompt. Afterwards: go straight to the settings pane,
      // and only when the user asks (never repeatedly on our own).
      if (prompted) await native.openAccessibilitySettings();
      else await native.requestAccessibility();
    } catch (e) {
      log("warn", `Accessibility request failed: ${String(e)}`);
    }
    if (!prompted) await this.settings.update({ accessibilityPrompted: true });
    if (this.view === "onboarding") return this.showOnboarding(2);
    const key = formatShortcut(this.settings.get().hotkey);
    this.bubble.setHint(`After allowing AI Pet in System Settings, select text and press ${key} again.`);
  }

  // ------------------------------------------------------------------ AI work

  /** Cancel whatever is running, then hand out a fresh signal (§69). */
  private beginRequest(): AbortController {
    this.cancelRequest();
    this.tts.stop();
    clearTimeout(this.errorTimer);
    this.request = new AbortController();
    return this.request;
  }

  private cancelRequest(): void {
    if (this.request) {
      this.request.abort();
      this.request = null;
    }
  }

  private async runTask(task: PetTask, context: TaskContext): Promise<void> {
    const handler = this.runner.get(task);
    const req = this.beginRequest();
    this.lastTask = { task, context };
    this.lastAnswer = "";
    const s = this.settings.get();
    const subjectText = context.selectedText ?? context.clipboardText ?? "";
    const subtitle =
      task === "translate" ? planTranslation(subjectText, s.translateTarget, s.autoSecondLanguage).label : undefined;
    const base: BubbleModel = { title: handler.title, subtitle, quote: this.subject ?? undefined };

    this.fsm.transition("THINKING");
    await this.showBubble({ ...base, text: "", textState: "thinking" }, "result");
    const speaker = this.makeSpeaker();
    try {
      const result = await this.runner.run(task, context, {
        signal: req.signal,
        onDelta: (delta, full) => {
          if (this.fsm.is("THINKING")) this.fsm.transition("SPEAKING");
          this.bubble.setText(full);
          speaker?.push(delta);
          this.scheduleRefit();
        },
        onReset: () => {
          this.bubble.setText("", "thinking");
          speaker?.reset();
          this.tts.stop();
        },
      });
      if (req !== this.request) return;
      this.request = null;
      speaker?.flush();
      this.lastAnswer = result.text;
      this.history = [
        { role: "user", content: `${handler.label}:\n${subjectText}` },
        { role: "assistant", content: result.text },
      ];
      await this.showBubble(
        {
          ...base,
          text: result.text,
          actions: this.resultActions(),
          input: { placeholder: "Ask a follow-up…" },
        },
        "result",
      );
      this.afterAnswer();
    } catch (error) {
      if (isCancellation(error) || req !== this.request) return;
      this.request = null;
      speaker?.reset();
      await this.showBubble(
        {
          ...base,
          text: friendlyError(error),
          textState: "error",
          actions: needsSettings(error)
            ? [
                { id: "open-settings", label: "Open Settings", primary: true },
                { id: "back", label: "Back" },
              ]
            : [
                { id: "retry", label: "Try again", primary: true },
                { id: "back", label: "Back" },
              ],
        },
        "result",
      );
      this.onError(error);
    }
  }

  private async sendChat(text: string): Promise<void> {
    const req = this.beginRequest();
    if (this.view !== "chat") {
      // Coming from a result or the task menu: keep the context, switch to chat.
      this.transcript = [];
      this.fsm.transition("INTERACTING");
      await this.showBubble(this.chatModel(), "chat");
    }
    const answer: TranscriptLine = { role: "assistant", text: "", state: "pending" };
    this.transcript.push({ role: "user", text }, answer);
    this.bubble.setTranscript(this.transcript);
    this.scheduleRefit();
    this.fsm.transition("THINKING");
    const speaker = this.makeSpeaker();
    const task: PetTask = this.subject ? "ask" : "chat";
    try {
      const result = await this.runner.run(
        task,
        { userPrompt: text, selectedText: this.subject?.text, history: this.history },
        {
          signal: req.signal,
          onDelta: (delta, full) => {
            if (this.fsm.is("THINKING")) this.fsm.transition("SPEAKING");
            answer.text = full;
            answer.state = undefined;
            this.bubble.setTranscript(this.transcript);
            speaker?.push(delta);
            this.scheduleRefit();
          },
          onReset: () => {
            answer.text = "";
            answer.state = "pending";
            speaker?.reset();
            this.tts.stop();
          },
        },
      );
      if (req !== this.request) return;
      this.request = null;
      speaker?.flush();
      answer.text = result.text;
      answer.state = undefined;
      this.lastAnswer = result.text;
      this.history.push({ role: "user", content: text }, { role: "assistant", content: result.text });
      this.history = this.history.slice(-HISTORY_LIMIT);
      this.bubble.setTranscript(this.transcript);
      this.scheduleRefit();
      this.afterAnswer();
    } catch (error) {
      if (isCancellation(error) || req !== this.request) return;
      this.request = null;
      speaker?.reset();
      answer.text = friendlyError(error);
      answer.state = "error";
      this.bubble.setTranscript(this.transcript);
      if (needsSettings(error)) this.bubble.setHint("You can fix this in Settings (right-click me).");
      this.onError(error);
    }
  }

  private resultActions(): MenuButton[] {
    return [
      { id: "copy", label: "Copy", icon: "📋", primary: true },
      this.tts.speaking ? { id: "stop-speaking", label: "Stop", icon: "⏹" } : { id: "speak", label: "Speak", icon: "🔊" },
      { id: "back", label: "Back", icon: "↩" },
    ];
  }

  private afterAnswer(): void {
    if (!this.tts.speaking && this.fsm.is("THINKING", "SPEAKING")) this.fsm.transition("INTERACTING");
    this.bubble.focusInput();
  }

  private onError(error: unknown): void {
    log("error", `AI task failed (${error instanceof Error ? error.message : "unknown"})`);
    this.fsm.transition("ERROR");
    clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => {
      if (this.fsm.is("ERROR")) this.fsm.transition(this.expanded ? "INTERACTING" : "IDLE");
    }, ERROR_SHOW_MS);
  }

  private makeSpeaker(): SentenceStreamer | null {
    if (!this.settings.get().speak) return null;
    return new SentenceStreamer((sentence) => this.tts.speak(sentence, speechLangFor(sentence)));
  }

  private onSpeakingChange(speaking: boolean): void {
    if (speaking) {
      if (this.fsm.is("THINKING", "INTERACTING", "IDLE")) this.fsm.transition("SPEAKING");
    } else if (this.fsm.is("SPEAKING") && !this.request) {
      this.fsm.transition(this.expanded ? "INTERACTING" : "IDLE");
    }
  }

  // ------------------------------------------------------------------ window & layout

  private async showBubble(model: BubbleModel, view: View): Promise<void> {
    const opening = !this.expanded;
    this.view = view;
    this.bubble.render(model);
    this.bubble.prepareWidth(BUBBLE_WIDTH);
    if (opening) this.bubble.el.classList.add("is-opening");
    await this.applyExpanded(this.bubble.naturalHeight(), opening ? this.preferSide : this.expanded!.side);
    if (opening) requestAnimationFrame(() => this.bubble.el.classList.remove("is-opening"));
  }

  private async applyExpanded(bubbleHeight: number, prefer: BubbleSide): Promise<void> {
    const screen = this.currentScreen();
    if (!screen) return;
    const layout = expandedLayout(this.petPos, this.size, bubbleHeight, screen.visibleFrame, prefer);
    this.expanded = layout;
    this.root.dataset.mode = "expanded";
    this.pet.place(layout.pet.x, layout.pet.y, this.size);
    this.bubble.layout(layout.bubble, layout.side, layout.tailX, layout.maxBubbleHeight);
    await native.setClickThrough(false, null);
    await native.setPetFrame(layout.frame);
  }

  private async applyCompact(): Promise<void> {
    this.expanded = null;
    this.root.dataset.mode = "compact";
    this.bubble.hide();
    this.pet.place(0, 0, this.size);
    await native.setPetFrame(compactFrame(this.petPos, this.size));
    await native.setClickThrough(true, petHitRect(this.size));
  }

  /** Grow/shrink the window as streamed content changes the bubble's height. */
  private scheduleRefit(): void {
    if (this.refitTimer) return;
    this.refitTimer = setTimeout(() => {
      this.refitTimer = null;
      const layout = this.expanded;
      if (!layout) return;
      const wanted = this.bubble.naturalHeight();
      const target = Math.min(wanted, layout.maxBubbleHeight);
      if (Math.abs(target - layout.bubble.height) < 6) return;
      void this.applyExpanded(wanted, layout.side);
    }, 120);
  }

  async closeBubble(): Promise<void> {
    if (!this.expanded) return;
    this.cancelRequest();
    this.tts.stop();
    clearTimeout(this.errorTimer);
    this.view = "none";
    this.preferSide = "above";
    this.resetConversation();
    await this.applyCompact();
    if (!this.fsm.is("OFF")) this.fsm.transition("IDLE");
    void native.releaseFocus();
    this.touch();
    this.scheduleRoamResume();
  }

  private resetConversation(): void {
    this.subject = null;
    this.transcript = [];
    this.history = [];
    this.lastAnswer = "";
    this.lastTask = null;
  }

  private async takeFocus(): Promise<void> {
    try {
      await native.focusPet();
    } catch {
      // Not fatal: the user can still click into the bubble.
    }
    this.bubble.focusInput();
  }

  private currentScreen(): ScreenInfo | undefined {
    return screenForPoint(petCenter(this.petPos, this.size), this.screens) ?? primaryScreen(this.screens);
  }

  private async refreshScreens(): Promise<ScreenInfo[]> {
    try {
      const screens = await native.getScreens();
      if (screens.length) this.screens = screens;
    } catch {
      // keep the last known layout
    }
    // A display was unplugged or rearranged: bring the pet back into view.
    const screen = screenForPoint(petCenter(this.petPos, this.size), this.screens);
    if (screen && !this.expanded && !this.fsm.is("OFF")) {
      const safe = clampPet(this.petPos, this.size, screen.visibleFrame);
      if (safe.x !== this.petPos.x || safe.y !== this.petPos.y) {
        this.petPos = safe;
        await native.setPetFrame(compactFrame(safe, this.size));
      }
    }
    return this.screens;
  }

  private applyAppearance(): void {
    const s = this.settings.get();
    this.size = petBoxSize(s.petSize);
    this.pet.setScale(s.petSize);
    this.pet.setSpeed(s.animationSpeed);
  }

  // ------------------------------------------------------------------ roaming & motion

  private moveTo(target: Point, durationMs: number): Promise<boolean> {
    return native
      .movePetTo(target.x, target.y, durationMs)
      .then((id) => new Promise<boolean>((resolve) => this.motionWaiters.set(id, resolve)))
      .catch(() => false);
  }

  private settleMotion(id: number, arrived: boolean): void {
    this.motionWaiters.get(id)?.(arrived);
    this.motionWaiters.delete(id);
  }

  private stopMotion(): void {
    const epoch = this.placementEpoch;
    void native.stopPetMotion().then((frame) => {
      if (!this.expanded && epoch === this.placementEpoch) this.petPos = { x: frame.x, y: frame.y };
    });
    for (const id of [...this.motionWaiters.keys()]) this.settleMotion(id, false);
  }

  private stopRoaming(): void {
    clearTimeout(this.resumeTimer);
    this.roaming.stop();
    if (this.fsm.is("WALKING")) this.fsm.transition("IDLE");
  }

  private scheduleRoamResume(delay = ROAM_RESUME_MS): void {
    clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => this.maybeStartRoaming(), delay);
  }

  private maybeStartRoaming(): void {
    const s = this.settings.get();
    if (!s.roaming || !s.petEnabled || this.expanded || this.drag || !this.fsm.is("IDLE")) return;
    this.roaming.start();
  }

  // ------------------------------------------------------------------ sleep

  private touch(): void {
    this.lastInteraction = Date.now();
    if (this.fsm.is("SLEEPING")) this.wake();
  }

  private checkSleep(): void {
    if (this.expanded || !this.fsm.is("IDLE", "WALKING")) return;
    if (Date.now() - this.lastInteraction < SLEEP_AFTER_MS) return;
    this.stopRoaming();
    this.fsm.transition("SLEEPING");
    this.napTimer = setTimeout(() => this.wake(), NAP_MIN_MS + Math.random() * (NAP_MAX_MS - NAP_MIN_MS));
  }

  private wake(): void {
    clearTimeout(this.napTimer);
    if (!this.fsm.is("SLEEPING")) return;
    this.lastInteraction = Date.now();
    this.fsm.transition("IDLE");
    this.anim.gesture("blink");
    this.scheduleRoamResume(2000);
  }

  // ------------------------------------------------------------------ position persistence

  private maybeSavePosition(): void {
    if (Date.now() - this.lastPositionSave > POSITION_SAVE_MS) void this.savePosition();
  }

  private async savePosition(): Promise<void> {
    this.lastPositionSave = Date.now();
    try {
      await this.settings.update({ lastPosition: { ...this.petPos } });
    } catch {
      // non-critical
    }
  }

  // ------------------------------------------------------------------ pointer: click, double-click, drag, menu

  private bindPointer(): void {
    const el = this.pet.el;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.touch();
      this.stopRoaming();
      this.drag = {
        pointerId: e.pointerId,
        startX: e.screenX,
        startY: e.screenY,
        origin: native.getPetFrame().then((f) => ({ x: f.x, y: f.y })),
        moved: false,
        target: null,
      };
    });
    el.addEventListener("pointermove", (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.pointerId) return;
      const dx = e.screenX - d.startX;
      const dy = e.screenY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!d.moved) {
        d.moved = true;
        this.root.classList.add("is-dragging");
        void native.setClickThrough(false, null);
      }
      void d.origin.then((o) => {
        if (this.drag !== d) return;
        d.target = { x: o.x + dx, y: o.y + dy };
        this.pumpDrag();
      });
    });
    const finish = (e: PointerEvent, cancelled: boolean) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.pointerId) return;
      this.drag = null;
      if (d.moved) void this.endDrag(d);
      else if (!cancelled) this.onPetClick();
      else this.scheduleRoamResume();
    };
    el.addEventListener("pointerup", (e) => finish(e, false));
    el.addEventListener("pointercancel", (e) => finish(e, true));
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      void this.showContextMenu();
    });
  }

  /** At most one move in flight; always ends on the latest pointer position. */
  private pumpDrag(): void {
    const d = this.drag;
    if (this.dragInFlight || !d?.target) return;
    this.dragInFlight = true;
    const t = d.target;
    void native.setPetPosition(t.x, t.y).finally(() => {
      this.dragInFlight = false;
      if (this.drag === d && d.target && (d.target.x !== t.x || d.target.y !== t.y)) this.pumpDrag();
    });
  }

  private async endDrag(d: DragState): Promise<void> {
    this.root.classList.remove("is-dragging");
    const origin = d.target ?? (await d.origin);
    await native.setPetPosition(origin.x, origin.y);
    const offset = this.expanded ? this.expanded.pet : { x: 0, y: 0 };
    this.placementEpoch++;
    this.petPos = { x: origin.x + offset.x, y: origin.y + offset.y };
    await this.refreshScreens();
    const screen = this.currentScreen();
    if (screen) this.petPos = clampPet(this.petPos, this.size, screen.visibleFrame);
    if (this.expanded) await this.applyExpanded(this.bubble.naturalHeight(), this.expanded.side);
    else await this.applyCompact();
    await this.savePosition();
    if (!this.expanded) this.scheduleRoamResume();
  }

  private onPetClick(): void {
    if (this.clickTimer) {
      clearTimeout(this.clickTimer);
      this.clickTimer = null;
      void this.openChat(); // double-click
      return;
    }
    this.clickTimer = setTimeout(() => {
      this.clickTimer = null;
      void this.onSingleClick();
    }, DOUBLE_CLICK_MS);
  }

  private async onSingleClick(): Promise<void> {
    if (this.expanded) return this.closeBubble();
    this.fsm.transition("INTERACTING");
    this.anim.gesture("happy");
    await this.showQuickMenu();
  }

  private async showContextMenu(): Promise<void> {
    this.touch();
    const s = this.settings.get();
    const toggle = (patch: Partial<Settings>) => () => void this.settings.update(patch);
    const menu = await Menu.new({
      items: [
        { id: "title", text: "AI Pet", enabled: false },
        { item: "Separator" },
        { id: "chat", text: "Chat", action: () => void this.openChat() },
        { id: "settings", text: "Settings…", action: () => void native.openSettingsWindow() },
        { id: "pause", text: "Pause roaming", enabled: s.roaming, action: toggle({ roaming: false }) },
        { id: "resume", text: "Resume roaming", enabled: !s.roaming, action: toggle({ roaming: true }) },
        { id: "mute", text: "Mute", checked: !s.speak, action: toggle({ speak: !s.speak }) },
        { id: "enabled", text: "Pet enabled", checked: s.petEnabled, action: toggle({ petEnabled: !s.petEnabled }) },
        { id: "login", text: "Launch at startup", checked: s.launchAtLogin, action: toggle({ launchAtLogin: !s.launchAtLogin }) },
        { item: "Separator" },
        { id: "quit", text: "Quit", action: () => void native.quitApp() },
      ],
    });
    await menu.popup();
    // Menu actions arrive asynchronously; free the native menu a little later.
    setTimeout(() => void menu.close().catch(() => undefined), 3000);
  }

  private bindKeys(): void {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.expanded && !e.defaultPrevented) {
        e.preventDefault();
        void this.closeBubble();
      }
    });
    // Clicking elsewhere closes a bubble that has nothing worth keeping on screen.
    window.addEventListener("blur", () => {
      setTimeout(() => {
        if (document.hasFocus() || !this.expanded || this.request || this.drag) return;
        const disposable = ["quick", "tasks", "no-selection", "notice"].includes(this.view) ||
          (this.view === "chat" && this.transcript.length === 0);
        if (disposable && !this.bubble.inputValue.trim()) void this.closeBubble();
      }, 150);
    });
  }

  // ------------------------------------------------------------------ settings

  private onSettingsChanged(next: Settings, prev: Settings): void {
    if (next.petSize !== prev.petSize || next.animationSpeed !== prev.animationSpeed) {
      this.applyAppearance();
      if (!this.fsm.is("OFF")) {
        const screen = this.currentScreen();
        if (screen) this.petPos = clampPet(this.petPos, this.size, screen.visibleFrame);
        if (this.expanded) void this.applyExpanded(this.bubble.naturalHeight(), this.expanded.side);
        else void this.applyCompact();
      }
    }
    if (next.roaming !== prev.roaming) {
      if (next.roaming) this.scheduleRoamResume(800);
      else this.stopRoaming();
    }
    if (prev.speak && !next.speak) this.tts.stop();
    if (prev.firstRunCompleted && !next.firstRunCompleted && !this.fsm.is("OFF")) {
      this.cancelRequest();
      this.stopRoaming();
      this.resetConversation();
      void this.showOnboarding(0);
    }
    if (next.hotkey !== prev.hotkey || next.provider !== prev.provider || next.model !== prev.model) {
      void native.getAppStatus().then((s) => (this.status = s)).catch(() => undefined);
    }
  }
}
