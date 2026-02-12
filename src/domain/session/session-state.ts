/**
 * LOCO session state machine.
 *
 * Lifecycle:
 *   Disconnected → Connecting → Authenticating → Ready
 *                      ↑                           │
 *                      └── Reconnecting ←──────────┘ (on disconnect)
 *                              │
 *                              └→ Closed (max retries / explicit close)
 */

export enum SessionState {
  /** Initial state. Not connected. */
  Disconnected = 'disconnected',
  /** TLS socket connecting + CHECKIN in progress */
  Connecting = 'connecting',
  /** Connected, LOGINLIST command in progress */
  Authenticating = 'authenticating',
  /** Fully operational: LOGINLIST succeeded, heartbeat active */
  Ready = 'ready',
  /** Connection lost, attempting to reconnect */
  Reconnecting = 'reconnecting',
  /** Permanently closed (user-initiated or max retries exhausted) */
  Closed = 'closed',
}

/** Valid state transitions */
const TRANSITIONS: Record<SessionState, SessionState[]> = {
  [SessionState.Disconnected]: [SessionState.Connecting, SessionState.Closed],
  [SessionState.Connecting]: [SessionState.Authenticating, SessionState.Disconnected, SessionState.Closed],
  [SessionState.Authenticating]: [SessionState.Ready, SessionState.Disconnected, SessionState.Closed],
  [SessionState.Ready]: [SessionState.Reconnecting, SessionState.Closed],
  [SessionState.Reconnecting]: [SessionState.Connecting, SessionState.Closed],
  [SessionState.Closed]: [], // Terminal state
};

/**
 * Manages session state transitions with validation.
 */
export class SessionStateMachine {
  private _state: SessionState = SessionState.Disconnected;
  private _onTransition?: (from: SessionState, to: SessionState) => void;

  constructor(onTransition?: (from: SessionState, to: SessionState) => void) {
    this._onTransition = onTransition;
  }

  /** Current session state */
  get state(): SessionState {
    return this._state;
  }

  /** Whether the session is in a usable (Ready) state */
  get isReady(): boolean {
    return this._state === SessionState.Ready;
  }

  /** Whether the session is in a terminal (Closed) state */
  get isClosed(): boolean {
    return this._state === SessionState.Closed;
  }

  /**
   * Transition to a new state.
   * Throws if the transition is not valid from the current state.
   */
  transition(to: SessionState): void {
    const allowed = TRANSITIONS[this._state];

    if (!allowed.includes(to)) {
      throw new Error(
        `Invalid session state transition: ${this._state} → ${to}`,
      );
    }

    const from = this._state;
    this._state = to;
    this._onTransition?.(from, to);
  }

  /**
   * Try to transition; returns false instead of throwing if invalid.
   */
  tryTransition(to: SessionState): boolean {
    const allowed = TRANSITIONS[this._state];
    if (!allowed.includes(to)) {
      return false;
    }

    const from = this._state;
    this._state = to;
    this._onTransition?.(from, to);
    return true;
  }

  /** Reset to initial disconnected state (for internal use) */
  reset(): void {
    this._state = SessionState.Disconnected;
  }
}
