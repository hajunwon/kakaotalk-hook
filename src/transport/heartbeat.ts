/**
 * LOCO PING keepalive heartbeat.
 * Sends periodic PING commands and monitors for PONG responses.
 */

export class Heartbeat {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPongAt = 0;

  constructor(
    /** Interval between PING commands (default: 60s) */
    private readonly intervalMs: number = 60_000,
    /** Timeout after which connection is considered dead (default: 90s) */
    private readonly timeoutMs: number = 90_000,
    /** Function to send a PING command */
    private readonly sendPing: () => Promise<void>,
    /** Called when no PONG is received within timeout */
    private readonly onTimeout: () => void,
  ) {}

  /** Start the heartbeat timer */
  start(): void {
    this.stop();
    this.lastPongAt = Date.now();

    this.timer = setInterval(async () => {
      // Check if we've timed out
      if (Date.now() - this.lastPongAt > this.timeoutMs) {
        this.stop();
        this.onTimeout();
        return;
      }

      try {
        await this.sendPing();
      } catch {
        // PING failure will be caught by timeout
      }
    }, this.intervalMs);

    // Don't keep the process alive just for heartbeat
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /** Stop the heartbeat timer */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Call when a PONG response is received */
  receivedPong(): void {
    this.lastPongAt = Date.now();
  }

  /** Whether the heartbeat is currently active */
  get active(): boolean {
    return this.timer !== null;
  }
}
