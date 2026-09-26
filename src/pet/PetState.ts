/** The pet's finite state machine (guide §39). */

export type PetState =
  | "OFF"
  | "IDLE"
  | "WALKING"
  | "INTERACTING"
  | "THINKING"
  | "SPEAKING"
  | "LISTENING"
  | "ERROR"
  | "SLEEPING";

const ALLOWED: Record<PetState, readonly PetState[]> = {
  OFF: ["IDLE"],
  IDLE: ["OFF", "WALKING", "INTERACTING", "SLEEPING", "SPEAKING"],
  WALKING: ["OFF", "IDLE", "INTERACTING"],
  SLEEPING: ["OFF", "IDLE", "WALKING", "INTERACTING"],
  INTERACTING: ["OFF", "IDLE", "THINKING", "SPEAKING", "LISTENING", "ERROR"],
  THINKING: ["OFF", "IDLE", "INTERACTING", "SPEAKING", "ERROR"],
  SPEAKING: ["OFF", "IDLE", "INTERACTING", "THINKING", "ERROR"],
  LISTENING: ["OFF", "IDLE", "INTERACTING", "THINKING", "ERROR"],
  ERROR: ["OFF", "IDLE", "INTERACTING", "THINKING"],
};

type Listener = (next: PetState, prev: PetState) => void;

export class PetStateMachine {
  private current: PetState = "OFF";
  private listeners = new Set<Listener>();

  get state(): PetState {
    return this.current;
  }

  can(next: PetState): boolean {
    return next === this.current || ALLOWED[this.current].includes(next);
  }

  /** Returns false (and changes nothing) for a transition the pet doesn't allow. */
  transition(next: PetState): boolean {
    if (next === this.current) return true;
    if (!ALLOWED[this.current].includes(next)) return false;
    const prev = this.current;
    this.current = next;
    for (const l of this.listeners) l(next, prev);
    return true;
  }

  is(...states: PetState[]): boolean {
    return states.includes(this.current);
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
