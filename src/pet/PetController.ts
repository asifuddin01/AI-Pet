import { Menu } from "@tauri-apps/api/menu";

import { friendlyError, isCancellation, needsSettings, type ChatMessage } from "../ai/AIProvider";
import { planTranslation, speechLangFor } from "../ai/language";
import { NativeAIProvider } from "../ai/NativeAIProvider";
import { HISTORY_LIMIT } from "../ai/PromptBuilder";
import type { PetTask, TaskContext } from "../ai/tasks";
import { TaskRunner } from "../ai/TaskRunner";
import { ChatBubble, type BubbleModel, type TranscriptLine } from "../components/ChatBubble";
import type { CharacterKind, CharacterView } from "../components/CharacterView";
import { ART_SIZE } from "../components/lucyArt";
import { Pet } from "../components/Pet";
import { SpritePet } from "../components/SpritePet";
import type { MenuButton } from "../components/TaskMenu";
import { ClipboardService } from "../services/ClipboardService";
import { log, native, on, type SearchResult } from "../services/native";
import { SelectedTextService } from "../services/SelectedTextService";
import { SettingsService } from "../services/SettingsService";
import { cleanForSpeech, SentenceStreamer } from "../services/speech";
import { TTSService } from "../services/TTSService";
import { VoiceService } from "../services/VoiceService";
import { Toolbox, type ToolReply } from "../tools";
import { CAPABILITIES, parsePetCommand, type PetCommand } from "../tools/petCommands";
import { parseSearch } from "../tools/search";
import { wakeReply } from "../tools/wake";
import { WakeService, type Wake } from "../services/WakeService";
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
import { PatDetector } from "./pat";
import { PetStateMachine } from "./PetState";
import { RoamingController, walkDurationMs } from "./RoamingController";
import {
  decideMood,
  HELLO_LINES,
  MOOD_INFO,
  MOOD_OUTFITS,
  moodLine,
  MoodTracker,
  OUTFIT_IDS,
  outfitById,
  PAT_LINES,
  pickOutfit,
  voiceFor,
  type Mood,
  type Outfit,
  type OutfitId,
} from "./Wardrobe";

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
/** How often Lucy reconsiders her mood (and maybe her outfit). */
const MOOD_MIN_MS = 20 * 60_000;
const MOOD_MAX_MS = 45 * 60_000;
/** Daily update check (only when turned on in Settings). */
const UPDATE_FIRST_MS = 60_000;
const UPDATE_EVERY_MS = 24 * 3_600_000;
/** Minutes between check-ins ("need anything?", "how do I look?"). */
const CHECK_IN_MINUTES: Record<Settings["checkInEvery"], [number, number]> = {
  rare: [90, 150],
  sometimes: [40, 80],
  often: [15, 30],
};
/** A check-in nobody answers closes itself. */
const CHECK_IN_SHOW_MS = 30_000;
const HELLO_SHOW_MS = 8_000;
/** Pats closer together than this get one reaction. */
const PAT_COOLDOWN_MS = 4_000;
const HELP_LINES = [
  "Need a hand with anything, choom?",
  "Stuck on something? I can translate, explain or keep time for you.",
  "Quiet in here. Want to talk?",
  "Anything I can do for you?",
  "Taking a breather? I'm around if you need me.",
];
const LOOK_LINES = ["How do I look?", "Be honest — does this outfit work?", "New look. Thoughts?", "Rate the fit, choom."];
const LOVE_REPLIES = ["Heh. I know. 😏", "Preem. Glad you like it. 💜", "You're sweet. I'll keep it on a while."];

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
  | "tools"
  | "checkin"
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
  hasSttKey: false,
  hasSearchKey: false,
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
  private character: CharacterView;
  /** Renderer actually in use (falls back to vector if a model/clip fails to load). */
  private characterKind: CharacterKind = "vector";
  private placement = { x: 0, y: 0 };
  private swapping: Promise<void> | null = null;
  private pendingNotice: { title: string; text: string } | null = null;
  private readonly bubble: ChatBubble;
  private readonly anim: AnimationController;
  private readonly roaming: RoamingController;
  private readonly tts: TTSService;
  private readonly runner: TaskRunner;
  private readonly tools: Toolbox;
  /** A Pomodoro focus block is running: she stays put and keeps a focused mood. */
  private focusMode = false;
  private readonly selection = new SelectedTextService();
  private readonly voice = new VoiceService();
  /** "Hey Lucy" listener (opt-in). */
  private readonly nameListener: WakeService;
  private checkInTimer: ReturnType<typeof setTimeout> | undefined;
  private checkInCloseTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly tracker = new MoodTracker();
  private mood: Mood;
  private moodTimer: ReturnType<typeof setTimeout> | undefined;

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
  private searchResults: SearchResult[] = [];

  private motionWaiters = new Map<number, (arrived: boolean) => void>();
  private drag: DragState | null = null;
  private dragInFlight = false;
  private clickTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  private napTimer: ReturnType<typeof setTimeout> | undefined;
  private errorTimer: ReturnType<typeof setTimeout> | undefined;
  private refitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastInteraction = Date.now();
  private readonly pats = new PatDetector();
  private lastPat = 0;
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
  private update: { version: string; url: string } | null = null;
  private updateTimer: ReturnType<typeof setTimeout> | undefined;
  private offerTimer: ReturnType<typeof setTimeout> | undefined;

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
    this.mood = decideMood(this.tracker.signals(false));
    this.character = new Pet(root, this.initialOutfit(settings.get()));
    this.bubble = new ChatBubble(root, {
      onTask: (id) => void this.onTask(id),
      onAction: (id) => void this.onAction(id),
      onSubmit: (text) => void this.onSubmit(text),
      onClose: () => void this.closeBubble(),
      onMic: () => void this.toggleListening(),
    });
    this.anim = new AnimationController(this.character);
    this.fsm.onChange((state) => {
      this.anim.apply(state);
      root.dataset.state = state.toLowerCase();
    });

    this.tts = new TTSService(() => {
      const delivery = voiceFor(this.mood);
      return {
        voice: this.settings.get().voice,
        rate: this.settings.get().speechRate * delivery.rate,
        pitch: delivery.pitch,
      };
    });
    this.tts.onSpeakingChange((speaking) => this.onSpeakingChange(speaking));

    const provider = new NativeAIProvider(() => (this.settings.get().requestTimeoutSecs + 15) * 1000);
    this.runner = new TaskRunner(provider, () => ({
      translateTarget: this.settings.get().translateTarget,
      autoSecondLanguage: this.settings.get().autoSecondLanguage,
      mood: this.mood,
    }));

    this.nameListener = new WakeService({
      onWake: (wake) => void this.onCalled(wake),
      onUnavailable: (message) => void this.wakeUnavailable(message),
    });

    this.tools = new Toolbox(
      { alert: (reply) => void this.toolAlert(reply), setFocus: (on) => this.setFocusMode(on) },
      { load: () => native.getNotes(), save: (notes) => native.saveNotes(notes) },
    );

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
      onWalkStart: (dx, dy, floating) => {
        this.character.setFacing(dx, dy);
        this.anim.setFloating(floating);
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
      on<{ pressed: boolean; cursor: Point }>("talk-hotkey", (e) => void this.onTalkKey(e.pressed, e.cursor)),
      on<Point>("pet-hover", (p) => {
        if (this.pats.push(p, Date.now())) this.onPetted();
      }),
    ]);
    this.settings.onChange((next, prev) => this.onSettingsChanged(next, prev));
    this.bindPointer(this.character.el);
    this.bindKeys();
    await on("characters-changed", () => {
      if (this.settings.get().character !== "vector") void this.swapCharacter();
    });
    this.character.setMood(this.mood);
    if (this.settings.get().character !== "vector") await this.swapCharacter();
    // A cheap once-a-minute check that lets an ignored pet doze off.
    setInterval(() => {
      this.checkSleep();
      this.syncWake();
    }, 60_000);
    this.scheduleMood();
    this.scheduleUpdateCheck(UPDATE_FIRST_MS);
    this.scheduleCheckIn();
    if (this.settings.get().petEnabled) await this.enable();
  }

  // ------------------------------------------------------------------ updates

  private scheduleUpdateCheck(delay = UPDATE_EVERY_MS): void {
    clearTimeout(this.updateTimer);
    if (!this.settings.get().checkUpdates) return;
    this.updateTimer = setTimeout(() => void this.checkForUpdate(), delay);
  }

  private async checkForUpdate(): Promise<void> {
    try {
      const info = await native.checkForUpdate();
      if (info.newer && info.latest && info.latest !== this.settings.get().skippedVersion) {
        this.update = { version: info.latest, url: info.url };
        await this.offerUpdate();
      }
    } catch {
      // Offline or GitHub unreachable: try again tomorrow.
    }
    this.scheduleUpdateCheck();
  }

  /** Mention a new version once she's free, without interrupting anything. */
  private async offerUpdate(): Promise<void> {
    if (!this.update) return;
    if (this.fsm.is("OFF") || this.expanded || !this.fsm.is("IDLE", "WALKING", "SLEEPING")) {
      clearTimeout(this.offerTimer);
      this.offerTimer = setTimeout(() => void this.offerUpdate(), 10 * 60_000);
      return;
    }
    this.stopRoaming();
    this.fsm.transition("INTERACTING");
    await this.showBubble(
      {
        title: "New version of me is out",
        text: `Version **${this.update.version}** is ready. Want to grab it?`,
        actions: [
          { id: "update-download", label: "Download", primary: true },
          { id: "update-later", label: "Skip this one" },
        ],
      },
      "notice",
    );
    this.anim.gesture("wave");
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
      if (s.currentOutfit !== this.character.currentOutfit.id) {
        void this.settings.update({ currentOutfit: this.character.currentOutfit.id }).catch(() => undefined);
      }
      if (!s.firstRunCompleted) {
        await this.showOnboarding(0);
      } else if (this.status.hotkeyWarnings.length && !this.warnedHotkeys) {
        this.warnedHotkeys = true;
        await this.showNotice("Shortcut problem", this.status.hotkeyWarnings.join("\n"), true);
      } else if (this.pendingNotice) {
        const { title, text } = this.pendingNotice;
        this.pendingNotice = null;
        await this.showNotice(title, text, true);
      } else {
        await this.showCheckIn("help", moodLine(HELLO_LINES, this.mood, s.userName));
        this.closeCheckInLater(HELLO_SHOW_MS);
      }
      this.syncWake();
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
    this.voice.cancel();
    this.nameListener.setActive(false);
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
    await this.showBubble({ title: "Scanning…", text: "", textState: "thinking" }, "capturing");
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
        title: "Got your text. What's the job?",
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
    const info = MOOD_INFO[this.mood];
    const status = this.tools.statusLine();
    await this.showBubble(
      {
        title: info.greeting,
        subtitle: `${info.emoji} Feeling ${this.mood} · wearing ${this.character.currentOutfit.name}`,
        text: status ?? undefined,
        tasks: [
          { id: "quick-chat", label: "Chat", icon: "💬" },
          { id: "quick-tools", label: "Tools", icon: "🧰" },
          { id: "quick-translate-clipboard", label: "Translate clipboard", icon: "🌐" },
          { id: "quick-outfit", label: "Change outfit", icon: "✨" },
          { id: "quick-settings", label: "Settings", icon: "⚙️" },
          { id: "quick-roam", label: roaming ? "Pause roaming" : "Resume roaming", icon: roaming ? "⏸" : "▶️" },
        ],
      },
      "quick",
    );
  }

  private async showTools(): Promise<void> {
    this.fsm.transition("INTERACTING");
    await this.showBubble(
      {
        title: "Tools",
        subtitle: this.tools.statusLine() ?? "Work offline — no AI needed",
        tasks: this.tools.buttons().map((b) => ({ id: `tool-${b.id}`, label: b.label, icon: b.icon })),
        input: { placeholder: "Try 25*4 or timer 5 min" },
      },
      "tools",
    );
    await this.takeFocus();
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
      title: this.subject ? "Ask me about it" : MOOD_INFO[this.mood].greeting,
      quote: this.subject ?? undefined,
      transcript: this.transcript,
      input: { placeholder: this.subject ? "Ask about the selected text…" : "Ask me something…" },
    };
  }

  private async showPermission(from: "hotkey" | "onboarding"): Promise<void> {
    const prompted = this.settings.get().accessibilityPrompted;
    await this.showBubble(
      {
        title: "Let me read your selections?",
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
          title: "Hey. I'm Lucy.",
          text:
            "Your desktop netrunner. I can:\n- Chat with you\n- Translate selected text\n- Explain words\n" +
            "- Summarize text\n- Speak my answers\n- Timers, notes and quick maths, even offline\n" +
            "- Change outfits when the mood hits\n\n" +
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
        title: "Plug me into an AI",
        text:
          "Chat and text tasks need an AI provider — OpenAI, Anthropic, a local Ollama model and more. " +
          "I'll still hang around without one.",
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
    const buttons: MenuButton[] = this.runner.menuTasks(this.subject?.text).map((h) => ({ id: h.id, label: h.label, icon: h.icon }));
    if (this.status.hasSearchKey) buttons.push({ id: "search", label: "Search web", icon: "🔎" });
    return buttons;
  }

  // ------------------------------------------------------------------ input handlers

  private async onTask(id: string): Promise<void> {
    this.touch();
    switch (id) {
      case "quick-chat":
        return this.openChat();
      case "quick-tools":
        return this.showTools();
      case "quick-translate-clipboard": {
        const text = await ClipboardService.readText();
        if (!text) return this.showNotice("Nothing to translate", "Your clipboard's got no text right now, choom.");
        this.subject = { text, truncated: false };
        return this.runTask("translate", { clipboardText: text });
      }
      case "quick-outfit": {
        await this.closeBubble();
        const next = pickOutfit(this.mood, this.character.currentOutfit.id);
        if (this.settings.get().outfit !== "auto") await this.settings.update({ outfit: next });
        else await this.changeOutfit(next);
        return;
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
    if (id.startsWith("tool-")) {
      const button = this.tools.buttons().find((b) => `tool-${b.id}` === id);
      if (!button) return;
      if (button.run) return this.onSubmit(button.run);
      this.bubble.inputValue = button.prefill ?? "";
      this.setHint(button.hint);
      this.bubble.focusInput();
      return;
    }
    if (id === "search") {
      const text = (this.subject?.text ?? this.bubble.inputValue).trim();
      if (!text) {
        this.setHint("Type what to search for.");
        this.bubble.focusInput();
        return;
      }
      return this.runSearch(text.replace(/\s+/g, " ").slice(0, 200));
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
    // Things she does herself ("wear the saree", "float around", "go to sleep")…
    const command = parsePetCommand(text);
    if (command) return this.runCommand(text, command);
    // "search for …", "google …", "weather in …"
    const query = parseSearch(text);
    if (query) return this.runSearch(query);
    // …then timers, notes, maths, units and the clock, answered on the spot, offline.
    const reply = await this.tools.handle(text).catch(() => null);
    if (reply) return this.showToolReply(text, reply);
    await this.sendChat(text);
  }

  private async showToolReply(text: string, reply: ToolReply): Promise<void> {
    this.cancelRequest();
    this.tts.stop();
    if (this.view !== "chat") {
      this.transcript = [];
      await this.showBubble(this.chatModel(), "chat");
    }
    this.fsm.transition("INTERACTING");
    this.transcript.push({ role: "user", text }, { role: "assistant", text: reply.text });
    // Kept in the chat history so follow-ups ("and in feet?") make sense to the AI.
    this.history.push({ role: "user", content: text }, { role: "assistant", content: reply.text });
    this.history = this.history.slice(-HISTORY_LIMIT);
    this.lastAnswer = reply.text;
    this.bubble.setTranscript(this.transcript);
    this.scheduleRefit();
    if (reply.gesture) this.anim.gesture(reply.gesture);
    this.say(reply);
    this.bubble.focusInput();
  }

  private say(reply: ToolReply): void {
    if (!this.settings.get().speak) return;
    const speech = reply.speech ?? cleanForSpeech(reply.text);
    if (speech) this.tts.speak(speech, speechLangFor(speech));
  }

  /** A timer rang or a focus block changed: tell the user, wherever she is. */
  private async toolAlert(reply: ToolReply): Promise<void> {
    if (this.fsm.is("OFF")) {
      this.pendingNotice = { title: reply.title, text: reply.text };
      return;
    }
    this.touch();
    if (this.expanded && this.view === "chat") {
      this.transcript.push({ role: "assistant", text: `**${reply.title}** ${reply.text}` });
      this.bubble.setTranscript(this.transcript);
      this.scheduleRefit();
    } else if (this.expanded && this.request) {
      this.setHint(`${reply.title} ${cleanForSpeech(reply.text)}`);
    } else {
      this.stopRoaming();
      await this.showNotice(reply.title, reply.text);
    }
    if (!this.request) this.say(reply);
    this.anim.gesture(reply.gesture ?? "wave");
  }

  private setFocusMode(on: boolean): void {
    this.focusMode = on;
    if (!on) {
      this.scheduleRoamResume();
      return;
    }
    this.stopRoaming();
    this.mood = "focused";
    this.character.setMood(this.mood);
    const current = this.character.currentOutfit.id;
    if (this.settings.get().outfit === "auto" && !MOOD_OUTFITS.focused.some(([id]) => id === current)) {
      void this.changeOutfit(pickOutfit("focused", current));
    }
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
      case "checkin-chat":
        return this.openChat();
      case "checkin-tools":
        return this.showTools();
      case "checkin-love": {
        this.anim.gesture("happy");
        const line = LOVE_REPLIES[Math.floor(Math.random() * LOVE_REPLIES.length)];
        await this.showBubble({ title: line, subtitle: this.outfitLine() }, "checkin");
        this.say({ title: "", text: line });
        this.closeCheckInLater(4000);
        return;
      }
      case "checkin-another": {
        const next = pickOutfit(this.mood, this.character.currentOutfit.id);
        await this.changeOutfit(next);
        return this.showCheckIn("look", "Better?");
      }
      case "checkin-dismiss":
        return this.closeBubble();
      case "link-1":
      case "link-2":
      case "link-3": {
        const r = this.searchResults[Number(id.slice(5)) - 1];
        if (r) await native.openSearchResult(r.link).catch((e) => this.setHint(String(e)));
        return;
      }
      case "update-download":
        if (this.update) await native.openReleasePage(this.update.url).catch(() => undefined);
        return this.closeBubble();
      case "update-later":
        if (this.update) await this.settings.update({ skippedVersion: this.update.version }).catch(() => undefined);
        this.update = null;
        return this.closeBubble();
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

  // ------------------------------------------------------------------ voice input

  /** Mic button: start listening, or send what was said so far. */
  private async toggleListening(): Promise<void> {
    if (this.voice.listening) return this.voice.stop();
    if (this.voice.active) return; // still transcribing the last one
    await this.startListening(false);
  }

  /** Hold-to-talk shortcut: pressed → show up and listen, released → send. */
  private async onTalkKey(pressed: boolean, cursor: Point): Promise<void> {
    if (this.fsm.is("OFF")) return;
    if (!pressed) {
      await this.voice.stop();
      return;
    }
    if (this.voice.active) return; // key repeat, or still transcribing
    this.touch();
    if (!this.expanded) {
      this.stopRoaming();
      await this.refreshScreens();
      const screen = screenForPoint(cursor, this.screens) ?? primaryScreen(this.screens);
      if (screen) {
        const { pet, side } = placeNearCursor(cursor, this.size, screen.visibleFrame, BUBBLE_ESTIMATE);
        this.placementEpoch++;
        this.petPos = pet;
        this.preferSide = side;
      }
      this.resetConversation();
    }
    await this.startListening(true);
  }

  private async startListening(hold: boolean, handsFree = false): Promise<void> {
    const s = this.settings.get();
    if (!s.voiceInput) {
      return this.showNotice("Voice input is off", "Turn it on in Settings → Voice, then talk to me.", true);
    }
    this.touch();
    this.cancelRequest();
    this.tts.stop();
    this.stopRoaming();
    if (!this.expanded || !["chat", "tools", "tasks", "no-selection", "result"].includes(this.view)) {
      this.fsm.transition("INTERACTING");
      await this.showBubble(this.chatModel(), "chat");
      await native.showPet();
      // Hands-free: don't pull keyboard focus away from what you're doing.
      if (!handsFree) await this.takeFocus();
    }
    this.fsm.transition("INTERACTING");
    this.fsm.transition("LISTENING");
    this.bubble.setListening(true);
    this.setHint(hold ? "Listening… let go when you're done." : "Listening… click 🎤 again to send.");
    this.nameListener.setActive(false);
    await this.voice.start(
      {
        onListening: () => this.anim.gesture("hop"),
        onPartial: (text) => {
          this.bubble.inputValue = text;
          this.scheduleRefit();
        },
        onFinal: (text) => {
          this.endListeningUi();
          if (!text) {
            this.setHint(hold ? "I didn't catch that. Hold the key while you talk." : "I didn't catch that.");
            return;
          }
          this.bubble.inputValue = "";
          void this.onSubmit(text);
        },
        onError: (kind, message) => {
          this.endListeningUi();
          this.setHint(message);
          log("warn", `Voice input failed (${kind})`);
          if (kind === "permission" || kind === "not_configured") this.anim.gesture("hop");
        },
      },
      // Whisper sends no live partials, so it can't tell when you've paused: click again to send.
      // After "Hey Lucy" it's hands-free: the live engine, ending at a pause.
      { autoStop: handsFree || (!hold && s.speechEngine === "apple"), handsFree },
    );
  }

  private endListeningUi(): void {
    this.bubble.setListening(false);
    this.setHint("");
    if (this.fsm.is("LISTENING")) this.fsm.transition("INTERACTING");
    setTimeout(() => this.syncWake(), 300);
  }

  /** Change the hint line and let the window grow or shrink to fit it. */
  private setHint(text: string): void {
    if (!this.expanded) return;
    this.bubble.setHint(text);
    this.scheduleRefit();
  }

  // ------------------------------------------------------------------ "Hey Lucy"

  /** Listen for her name only when it makes sense: on, visible, not already talking or listening. */
  private syncWake(): void {
    const s = this.settings.get();
    const on =
      s.voiceInput &&
      s.wakeWord &&
      !this.fsm.is("OFF") &&
      !this.voice.active &&
      !this.tts.speaking &&
      !this.request;
    this.nameListener.setActive(on);
  }

  private async wakeUnavailable(message: string): Promise<void> {
    log("warn", "Wake word listener unavailable");
    if (this.fsm.is("OFF")) return;
    if (this.expanded) this.setHint(message);
    else await this.showNotice("I can't listen for my name", message, true);
  }

  /** Someone said her name (or "I'm home"). */
  private async onCalled(wake: Wake): Promise<void> {
    if (this.fsm.is("OFF")) return;
    this.touch();
    this.stopRoaming();
    this.cancelCheckIn();
    if (!this.expanded || !["chat", "tools", "tasks", "no-selection", "result"].includes(this.view)) {
      this.fsm.transition("INTERACTING");
      await this.showBubble(this.chatModel(), "chat");
    }
    this.anim.gesture(wake.kind === "home" ? "wave" : "hop");
    if (wake.kind === "request") return this.onSubmit(wake.text);

    const line = wakeReply(wake);
    if (this.view === "chat") {
      if (wake.kind === "home") this.transcript.push({ role: "user", text: "I'm home!" });
      this.transcript.push({ role: "assistant", text: line });
      this.history.push(
        { role: "user", content: wake.kind === "home" ? "I'm home!" : "Lucy?" },
        { role: "assistant", content: line },
      );
      this.bubble.setTranscript(this.transcript);
      this.scheduleRefit();
    }
    this.say({ title: "", text: line });
    if (wake.kind === "home" && wake.rest) return this.onSubmit(wake.rest);
    // Then listen for what you want, hands-free, once she's done talking.
    await this.afterSpeech();
    if (this.expanded && !this.voice.active) await this.startListening(false, true);
  }

  /** Resolves when she has finished speaking (or after a few seconds at most). */
  private async afterSpeech(maxMs = 8000): Promise<void> {
    const until = Date.now() + maxMs;
    await new Promise((r) => setTimeout(r, 200));
    while (this.tts.speaking && Date.now() < until) await new Promise((r) => setTimeout(r, 120));
  }

  // ------------------------------------------------------------------ things she does when asked

  private outfitLine(): string {
    const o = this.character.currentOutfit;
    return `${o.emoji} ${o.name}`;
  }

  private async runCommand(text: string, command: PetCommand): Promise<void> {
    const s = this.settings.get();
    const reply = (title: string, body: string, gesture?: ToolReply["gesture"], speech?: string) =>
      this.showToolReply(text, { title, text: body, gesture, speech });
    const later = (ms: number, fn: () => void) => setTimeout(fn, ms);

    switch (command.kind) {
      case "help":
        return reply("What I can do", CAPABILITIES, "happy", "Here's what I can do.");
      case "status": {
        const doing = s.roaming ? (s.roamArea === "float" ? "floating around your screen" : "wandering around") : "hanging out here";
        return reply("Me?", `Just ${doing}, wearing my ${this.outfitLine()}. Feeling ${this.mood}. You?`, "hair-touch");
      }
      case "outfit-status":
        return reply("My outfit", `I'm wearing ${this.outfitLine()}.`, "hair-touch");
      case "outfit": {
        const next = command.id ?? pickOutfit(this.mood, this.character.currentOutfit.id);
        const o = outfitById(next);
        if (o.id === this.character.currentOutfit.id) return reply("Outfit", `Already wearing it — ${this.outfitLine()}.`, "happy");
        // In "let Lucy decide" mode she keeps choosing later; a fixed outfit stays fixed.
        if (s.outfit === "auto") await this.changeOutfit(o.id);
        else await this.settings.update({ outfit: o.id });
        return reply("New look", `${o.emoji} ${o.name}. How do I look?`, "hair-touch", `How do I look?`);
      }
      case "outfit-auto":
        await this.settings.update({ outfit: "auto" });
        return reply("Outfit", "Leave it to me. I'll dress for my mood.", "happy");
      case "roam": {
        const area = command.area ?? s.roamArea;
        await this.settings.update({ roaming: command.on, roamArea: area });
        if (!command.on) return reply("Okay", "Staying right here.", "happy");
        return reply(
          "Okay",
          area === "float" ? "Floating around 🫧 — say \"stay still\" to stop me." : "Going for a stroll.",
          "hop",
        );
      }
      case "come": {
        await reply("Coming", "On my way.", "hop");
        later(700, () => void this.comeToCursor());
        return;
      }
      case "sleep":
        await reply("Nap time", "Night, choom. Poke me when you need me. 💤");
        later(1800, () => void this.closeBubble().then(() => this.goToSleep()));
        return;
      case "wake":
        this.wake();
        return reply("I'm up", "I'm awake, I'm awake.", "happy");
      case "shush":
        this.tts.stop();
        return this.closeBubble();
      case "mute":
        if (command.on) {
          await this.settings.update({ speak: false });
          return reply("Quiet mode", "Going quiet. Say \"talk to me\" to hear me again.");
        }
        await this.settings.update({ speak: true });
        return reply("I'm back", "There's my voice. Missed me?", "happy");
      case "hide": {
        const key = formatShortcut(s.toggleHotkey);
        await reply("See you", `Hiding. Press ${key} to bring me back.`, "wave");
        later(1800, () => void this.settings.update({ petEnabled: false }));
        return;
      }
      case "bye":
        this.anim.gesture("wave");
        this.say({ title: "", text: "Later, choom." });
        later(900, () => void this.closeBubble());
        return;
      case "settings":
        await this.closeBubble();
        return native.openSettingsWindow();
      case "translate-clipboard":
        return this.onTask("quick-translate-clipboard");
      case "gesture":
        if (command.gesture === "dance") {
          const moves: ToolReply["gesture"][] = ["hop", "happy", "hop", "wave"];
          moves.forEach((g, i) => later(i * 650, () => g && this.anim.gesture(g)));
          return reply("💃", "Like this?");
        }
        this.anim.gesture(command.gesture);
        return reply(command.gesture === "wave" ? "👋" : "✨", command.gesture === "wave" ? "Hey there!" : "Heh.");
    }
  }

  /** Look something up on the web, then (if an AI is set up) answer from the results with sources. */
  private async runSearch(query: string): Promise<void> {
    const req = this.beginRequest();
    const base: BubbleModel = { title: "Searching the web…", subtitle: `🔎 ${query}` };
    this.fsm.transition("INTERACTING");
    this.fsm.transition("THINKING");
    await this.showBubble({ ...base, text: "", textState: "thinking" }, "result");
    let results: SearchResult[];
    try {
      results = await native.webSearch(query);
    } catch (e) {
      if (req !== this.request) return;
      this.request = null;
      const message = String(e);
      await this.showBubble(
        {
          ...base,
          title: "Search",
          text: message,
          textState: "error",
          actions: /Settings/.test(message)
            ? [{ id: "open-settings", label: "Open Settings", primary: true }, { id: "back", label: "Back" }]
            : [{ id: "back", label: "Back" }],
        },
        "result",
      );
      this.fsm.transition("INTERACTING");
      return;
    }
    if (req !== this.request) return;
    this.searchResults = results;
    const sources = results.map((r, i) => `${i + 1}. **${r.title}** — ${r.site}`).join("\n");
    const linkButtons: MenuButton[] = results
      .slice(0, 3)
      .map((r, i) => ({ id: `link-${i + 1}`, label: `${i + 1} ${r.site}`, icon: "🔗" }));
    if (!results.length) {
      this.request = null;
      this.fsm.transition("INTERACTING");
      await this.showBubble({ ...base, title: "Search", text: `Nothing came up for “${query}”.`, input: { placeholder: "Try other words…" } }, "result");
      return;
    }
    const listOnly = async (note?: string) => {
      this.request = null;
      this.lastAnswer = sources;
      await this.showBubble(
        {
          ...base,
          title: "From the web",
          text: `${results.map((r, i) => `${i + 1}. **${r.title}** — ${r.snippet}`).join("\n")}${note ? `\n\n${note}` : ""}`,
          actions: [...linkButtons, { id: "back", label: "Back", icon: "↩" }],
          input: { placeholder: "Search again or ask a follow-up…" },
        },
        "result",
      );
      this.afterAnswer();
    };
    if (!this.status.aiConfigured) return listOnly();

    // Let the AI read the snippets and answer, citing [1], [2]…
    this.lastTask = null;
    const speaker = this.makeSpeaker();
    await this.showBubble({ ...base, title: "From the web", text: "", textState: "thinking" }, "result");
    try {
      const result = await this.runner.run(
        "search",
        { userPrompt: query, searchResults: results },
        {
          signal: req.signal,
          onDelta: (delta, full) => {
            if (this.fsm.is("THINKING")) this.fsm.transition("SPEAKING");
            this.bubble.setText(full);
            speaker?.push(delta.replace(/\[\d+\]/g, ""));
            this.scheduleRefit();
          },
          onReset: () => {
            this.bubble.setText("", "thinking");
            speaker?.reset();
            this.tts.stop();
          },
        },
      );
      if (req !== this.request) return;
      this.request = null;
      speaker?.flush();
      this.lastAnswer = result.text;
      this.history = [
        { role: "user", content: `Search: ${query}` },
        { role: "assistant", content: `${result.text}\n\nSources:\n${sources}` },
      ];
      await this.showBubble(
        {
          ...base,
          title: "From the web",
          text: `${result.text}\n\n${sources}`,
          actions: [...linkButtons, { id: "copy", label: "Copy", icon: "📋" }],
          input: { placeholder: "Ask a follow-up…" },
        },
        "result",
      );
      this.afterAnswer();
    } catch (error) {
      if (isCancellation(error) || req !== this.request) return;
      speaker?.reset();
      await listOnly(`(${friendlyError(error)})`);
    }
  }

  /** Walk (or float) over to the mouse pointer. */
  private async comeToCursor(): Promise<void> {
    await this.closeBubble();
    this.stopRoaming();
    const cursor = await native.getMousePosition().catch(() => null);
    await this.refreshScreens();
    const screen = cursor ? screenForPoint(cursor, this.screens) : undefined;
    if (!cursor || !screen) return;
    const target = clampPet({ x: cursor.x - this.size / 2, y: cursor.y - this.size * 0.2 }, this.size, screen.visibleFrame);
    const from = this.petPos;
    this.character.setFacing(target.x - from.x, target.y - from.y);
    this.anim.setFloating(this.settings.get().roamArea === "float");
    this.fsm.transition("WALKING");
    const arrived = await this.moveTo(target, walkDurationMs(from, target, this.settings.get().animationSpeed, true));
    this.petPos = arrived ? target : this.petPos;
    if (this.fsm.is("WALKING")) this.fsm.transition("IDLE");
    this.anim.gesture("wave");
    await this.savePosition();
    this.scheduleRoamResume(ROAM_RESUME_MS * 3);
  }

  private goToSleep(): void {
    if (this.fsm.is("OFF") || this.expanded) return;
    this.stopRoaming();
    this.fsm.transition("SLEEPING");
    clearTimeout(this.napTimer);
    this.napTimer = setTimeout(() => this.wake(), NAP_MAX_MS * 2);
  }

  // ------------------------------------------------------------------ check-ins

  private scheduleCheckIn(delay?: number, kind?: "help" | "look"): void {
    clearTimeout(this.checkInTimer);
    const s = this.settings.get();
    if (!s.checkIns) return;
    const [min, max] = CHECK_IN_MINUTES[s.checkInEvery] ?? CHECK_IN_MINUTES.sometimes;
    const ms = delay ?? (min + Math.random() * (max - min)) * 60_000;
    this.checkInTimer = setTimeout(() => void this.maybeCheckIn(kind), ms);
  }

  /** Pop up only when she's idle, you're at the Mac, and nothing else is going on. */
  private async maybeCheckIn(kind?: "help" | "look"): Promise<void> {
    const idleSecs = await native.getIdleSeconds().catch(() => 0);
    const free =
      !this.fsm.is("OFF", "SLEEPING") &&
      this.fsm.is("IDLE", "WALKING") &&
      !this.expanded &&
      !this.focusMode &&
      !this.voice.active &&
      !this.drag &&
      Date.now() - this.lastInteraction > 2 * 60_000;
    // Away from the keyboard for a while: nobody to talk to.
    if (!free || idleSecs > 5 * 60) {
      this.scheduleCheckIn(5 * 60_000, kind);
      return;
    }
    await this.showCheckIn(kind ?? (Math.random() < 0.5 ? "look" : "help"));
    this.scheduleCheckIn();
  }

  private async showCheckIn(kind: "help" | "look", title?: string): Promise<void> {
    this.stopRoaming();
    this.fsm.transition("INTERACTING");
    const pick = (lines: string[]) => lines[Math.floor(Math.random() * lines.length)];
    const line = title ?? pick(kind === "look" ? LOOK_LINES : HELP_LINES);
    await this.showBubble(
      kind === "look"
        ? {
            title: line,
            subtitle: this.outfitLine(),
            actions: [
              { id: "checkin-love", label: "😍 Gorgeous", primary: true },
              { id: "checkin-another", label: "✨ Try another" },
              { id: "checkin-dismiss", label: "Not now" },
            ],
          }
        : {
            title: line,
            actions: [
              { id: "checkin-chat", label: "💬 Chat", primary: true },
              { id: "checkin-tools", label: "🧰 Tools" },
              { id: "checkin-dismiss", label: "I'm good" },
            ],
          },
      "checkin",
    );
    this.anim.gesture(kind === "look" ? "hair-touch" : "wave");
    this.say({ title: "", text: line });
    this.closeCheckInLater(CHECK_IN_SHOW_MS);
  }

  private closeCheckInLater(ms: number): void {
    clearTimeout(this.checkInCloseTimer);
    this.checkInCloseTimer = setTimeout(() => {
      if (this.view === "checkin") void this.closeBubble();
    }, ms);
  }

  private cancelCheckIn(): void {
    clearTimeout(this.checkInCloseTimer);
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
      this.tracker.record("task");
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
    this.syncWake();
  }

  private onError(error: unknown): void {
    this.tracker.record("error");
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
    // Never listen for her name while she's talking (she'd hear herself).
    if (speaking) this.nameListener.setActive(false);
    else setTimeout(() => this.syncWake(), 500);
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
    if (model.input && this.settings.get().voiceInput) model = { ...model, input: { ...model.input, mic: true } };
    this.bubble.render(model);
    if (this.voice.listening) this.bubble.setListening(true);
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
    this.placeCharacter(layout.pet.x, layout.pet.y);
    this.bubble.layout(layout.bubble, layout.side, layout.tailX, layout.maxBubbleHeight);
    await native.setClickThrough(false, null);
    await native.setPetFrame(layout.frame);
  }

  private async applyCompact(): Promise<void> {
    this.expanded = null;
    this.root.dataset.mode = "compact";
    this.bubble.hide();
    this.placeCharacter(0, 0);
    await native.setPetFrame(compactFrame(this.petPos, this.size));
    await native.setClickThrough(true, petHitRect(this.size, this.characterKind));
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
    this.voice.cancel();
    clearTimeout(this.errorTimer);
    this.view = "none";
    this.preferSide = "above";
    this.resetConversation();
    await this.applyCompact();
    if (!this.fsm.is("OFF")) this.fsm.transition("IDLE");
    void native.releaseFocus();
    this.touch();
    this.scheduleRoamResume();
    this.syncWake();
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
    this.character.setScale(this.size / ART_SIZE);
    this.character.setSpeed(s.animationSpeed);
    if (s.theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = s.theme;
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
    if (!s.roaming || !s.petEnabled || this.focusMode || this.expanded || this.drag || !this.fsm.is("IDLE")) return;
    this.roaming.start();
  }

  // ------------------------------------------------------------------ sleep

  private touch(): void {
    this.lastInteraction = Date.now();
    this.tracker.record("interaction");
    if (this.fsm.is("SLEEPING")) this.wake();
  }

  /** You stroked her with the cursor: she leans into it and answers in her mood. */
  private onPetted(): void {
    if (this.fsm.is("OFF") || this.drag || this.voice.active || Date.now() - this.lastPat < PAT_COOLDOWN_MS) return;
    this.lastPat = Date.now();
    const mood = this.fsm.is("SLEEPING") ? "sleepy" : this.mood;
    this.touch();
    if (!this.expanded) {
      this.stopRoaming();
      this.scheduleRoamResume(6000);
    }
    this.anim.gesture("pat");
    if (mood === "playful") this.anim.gesture("happy");
    this.say({ title: "", text: moodLine(PAT_LINES, mood, this.settings.get().userName) });
  }

  private checkSleep(): void {
    if (this.expanded || !this.fsm.is("IDLE", "WALKING")) return;
    if (Date.now() - this.lastInteraction < SLEEP_AFTER_MS) return;
    this.stopRoaming();
    this.fsm.transition("SLEEPING");
    this.napTimer = setTimeout(() => this.wake(), NAP_MIN_MS + Math.random() * (NAP_MAX_MS - NAP_MIN_MS));
    void this.moodTick(); // sleepy: she may slip into something cosy
  }

  // ------------------------------------------------------------------ character renderer

  private placeCharacter(x: number, y: number): void {
    this.placement = { x, y };
    this.character.place(x, y, this.size);
  }

  /** Build the renderer chosen in Settings (3D model, clips/images or built-in). */
  private async createCharacter(
    kind: CharacterKind,
    outfit: Outfit,
    failed: (message: string) => void,
  ): Promise<CharacterView> {
    if (kind === "vrm") {
      const { VrmPet } = await import("../components/VrmPet");
      return new VrmPet(
        this.root,
        outfit,
        (name) => native.readCharacterFile("vrm", name),
        (o) => this.settings.get().outfitModels[o.id] || this.settings.get().vrmModel,
        failed,
      );
    }
    if (kind === "sprites") {
      const list = await native.listCharacters();
      return new SpritePet(this.root, outfit, list.sprites, (name) => native.readCharacterFile("sprite", name), failed);
    }
    return new Pet(this.root, outfit);
  }

  private async swapCharacter(kind: CharacterKind = this.settings.get().character): Promise<void> {
    while (this.swapping) await this.swapping;
    let release!: () => void;
    this.swapping = new Promise((resolve) => (release = resolve));
    let next: CharacterView | null = null;
    // A renderer can fail while it is still being built; report that once it is on screen.
    let failure: string | null = null;
    try {
      const old = this.character;
      next = await this.createCharacter(kind, old.currentOutfit, (message) => {
        if (next && this.character === next) void this.characterFailed(message);
        else failure ??= message;
      });
      this.root.insertBefore(next.el, this.bubble.el);
      this.character = next;
      this.characterKind = kind;
      this.applyAppearance();
      next.setMood(this.mood);
      next.place(this.placement.x, this.placement.y, this.size);
      this.bindPointer(next.el);
      this.anim.setView(next);
      old.dispose();
      if (!this.expanded && !this.fsm.is("OFF")) {
        await native.setClickThrough(true, petHitRect(this.size, kind)).catch(() => undefined);
      }
      log("info", `Character renderer: ${kind}`);
    } catch (e) {
      failure ??= e instanceof Error ? e.message : String(e);
    } finally {
      this.swapping = null;
      release();
    }
    if (failure && kind !== "vector") await this.characterFailed(failure);
  }

  /** Fall back to the built-in look and tell the user why. */
  private async characterFailed(message: string): Promise<void> {
    log("warn", `Character failed to load (${this.characterKind})`);
    if (this.characterKind !== "vector") await this.swapCharacter("vector");
    const title = "Couldn't load my look";
    const text = `${message} I'm using my built-in look for now.`;
    // Failures while the pet is hidden (e.g. at launch) are shown once she appears.
    if (this.fsm.is("OFF")) this.pendingNotice = { title, text };
    else await this.showNotice(title, text, true);
  }

  // ------------------------------------------------------------------ mood & wardrobe

  private initialOutfit(s: Settings): Outfit {
    if (s.outfit !== "auto") return outfitById(s.outfit);
    if (s.currentOutfit) return outfitById(s.currentOutfit);
    return outfitById(pickOutfit(this.mood, null));
  }

  private scheduleMood(delay = MOOD_MIN_MS + Math.random() * (MOOD_MAX_MS - MOOD_MIN_MS)): void {
    clearTimeout(this.moodTimer);
    this.moodTimer = setTimeout(() => void this.moodTick(), delay);
  }

  /** Re-read her mood; in "let Lucy decide" mode she may change clothes to match it. */
  private async moodTick(): Promise<void> {
    this.mood = this.focusMode ? "focused" : decideMood(this.tracker.signals(this.fsm.is("SLEEPING")));
    this.character.setMood(this.mood);
    if (this.settings.get().outfit === "auto" && !this.fsm.is("OFF")) {
      if (this.expanded || this.drag || !this.fsm.is("IDLE", "SLEEPING")) {
        this.scheduleMood(60_000); // busy — try again in a minute
        return;
      }
      const current = this.character.currentOutfit.id;
      const suits = MOOD_OUTFITS[this.mood].some(([id]) => id === current);
      if (!suits || Math.random() < 0.35) {
        await this.changeOutfit(pickOutfit(this.mood, current));
        // Fresh outfit: now and then she wants your opinion.
        if (!this.fsm.is("SLEEPING") && Math.random() < 0.5) this.scheduleCheckIn(25_000, "look");
      }
    }
    this.scheduleMood();
  }

  private async changeOutfit(id: OutfitId): Promise<void> {
    const outfit = outfitById(id);
    if (outfit.id === this.character.currentOutfit.id) return;
    if (this.fsm.is("OFF")) this.character.setOutfit(outfit);
    else await this.character.changeOutfit(outfit);
    log("info", `Outfit changed (${outfit.id}, mood ${this.mood})`);
    await this.settings.update({ currentOutfit: outfit.id }).catch(() => undefined);
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

  private bindPointer(el: HTMLElement): void {
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
        {
          text: "Movement",
          items: [
            { id: "roam-on", text: "Move around", checked: s.roaming, action: toggle({ roaming: true }) },
            { id: "roam-off", text: "Stay still", checked: !s.roaming, action: toggle({ roaming: false }) },
            { item: "Separator" },
            { id: "roam-float", text: "Float around the screen (hover)", checked: s.roamArea === "float", action: toggle({ roamArea: "float", roaming: true }) },
            { id: "roam-anywhere", text: "Walk anywhere", checked: s.roamArea === "anywhere", action: toggle({ roamArea: "anywhere", roaming: true }) },
            { id: "roam-bottom", text: "Walk along the bottom", checked: s.roamArea === "bottom", action: toggle({ roamArea: "bottom", roaming: true }) },
          ],
        },
        {
          text: "Outfit",
          items: [
            { id: "outfit-auto", text: "Let Lucy decide (mood)", checked: s.outfit === "auto", action: toggle({ outfit: "auto" }) },
            { item: "Separator" },
            ...OUTFIT_IDS.map((id) => {
              const o = outfitById(id);
              return {
                id: `outfit-${id}`,
                text: `${o.emoji}  ${o.name}`,
                checked: this.character.currentOutfit.id === id,
                action: toggle({ outfit: id }),
              };
            }),
          ],
        },
        {
          id: "focus",
          text: this.tools.pomodoro.running ? "Stop focus session" : "Start focus session (25 min)",
          action: () => void this.onSubmit(this.tools.pomodoro.running ? "stop pomodoro" : "pomodoro"),
        },
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
        if (document.hasFocus() || !this.expanded || this.request || this.drag || this.voice.active) return;
        const disposable = ["quick", "tools", "tasks", "no-selection", "notice", "checkin"].includes(this.view) ||
          (this.view === "chat" && this.transcript.length === 0);
        if (disposable && !this.bubble.inputValue.trim()) void this.closeBubble();
      }, 150);
    });
  }

  // ------------------------------------------------------------------ settings

  private onSettingsChanged(next: Settings, prev: Settings): void {
    if (next.theme !== prev.theme) this.applyAppearance();
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
    if (next.checkUpdates !== prev.checkUpdates) this.scheduleUpdateCheck(UPDATE_FIRST_MS);
    if (prev.voiceInput && !next.voiceInput) {
      this.voice.cancel();
      this.endListeningUi();
    }
    if (
      next.wakeWord !== prev.wakeWord ||
      next.voiceInput !== prev.voiceInput ||
      next.speechLanguage !== prev.speechLanguage
    ) {
      this.nameListener.setActive(false);
      this.nameListener.reset();
      this.syncWake();
    }
    if (next.checkIns !== prev.checkIns || next.checkInEvery !== prev.checkInEvery) this.scheduleCheckIn();
    const modelsChanged =
      next.vrmModel !== prev.vrmModel || JSON.stringify(next.outfitModels) !== JSON.stringify(prev.outfitModels);
    if (next.character !== prev.character || (next.character === "vrm" && modelsChanged)) {
      void this.swapCharacter();
    }
    if (next.outfit !== prev.outfit) {
      if (next.outfit === "auto") void this.moodTick();
      else void this.changeOutfit(next.outfit as OutfitId);
    }
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
