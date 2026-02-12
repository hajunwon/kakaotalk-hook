/**
 * Exponential backoff reconnection manager.
 * Handles automatic reconnection with configurable retry policy.
 */

export interface ReconnectPolicy {
  /** Maximum number of retry attempts (default: 10) */
  maxRetries: number;
  /** Base delay in milliseconds (default: 1000) */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds (default: 30000) */
  maxDelayMs: number;
  /** Jitter factor 0-1 to randomize delay (default: 0.3) */
  jitterFactor: number;
}

const DEFAULT_POLICY: ReconnectPolicy = {
  maxRetries: 10,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  jitterFactor: 0.3,
};

export class ReconnectManager {
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private policy: ReconnectPolicy;

  constructor(
    policy: Partial<ReconnectPolicy>,
    private readonly reconnectFn: () => Promise<void>,
    private readonly onGaveUp?: (attempts: number) => void,
  ) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  /** Schedule a reconnection attempt with exponential backoff */
  scheduleReconnect(): void {
    if (this.attempt >= this.policy.maxRetries) {
      this.onGaveUp?.(this.attempt);
      return;
    }

    const delay = this.calculateDelay();
    this.attempt++;

    this.timer = setTimeout(async () => {
      try {
        await this.reconnectFn();
        this.reset(); // Success — reset backoff
      } catch {
        this.scheduleReconnect(); // Failure — try again
      }
    }, delay);

    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /** Reset the backoff counter (call on successful connection) */
  reset(): void {
    this.attempt = 0;
    this.cancel();
  }

  /** Halt all reconnection attempts */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Current attempt number */
  get currentAttempt(): number {
    return this.attempt;
  }

  /** Calculate delay with exponential backoff + jitter */
  private calculateDelay(): number {
    const exponential = this.policy.baseDelayMs * Math.pow(2, this.attempt);
    const capped = Math.min(exponential, this.policy.maxDelayMs);

    // Apply jitter: delay * (1 - jitter + random * 2 * jitter)
    const jitter = this.policy.jitterFactor;
    const randomized = capped * (1 - jitter + Math.random() * 2 * jitter);

    return Math.round(randomized);
  }
}
