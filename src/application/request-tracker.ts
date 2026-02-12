/**
 * Request-response correlation for LOCO protocol.
 * Maps outgoing packetId → Promise, resolved when the server replies.
 *
 * Flow:
 *   sendMessage() → track(packetId, command) → Promise created
 *       → LocoSocket.sendPacket() → server
 *       → server responds → CommandDispatcher routes by packetId
 *       → resolve(packetId, packet) → Promise resolves
 */
import type { LocoPacket } from '../protocol/loco-packet';
import { TimeoutError } from '../types/errors';

export interface PendingRequest {
  command: string;
  resolve: (packet: LocoPacket) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RequestTracker {
  private pending = new Map<number, PendingRequest>();
  private _packetIdCounter = 0;

  constructor(
    /** Default timeout for requests in ms (default: 15s) */
    private readonly defaultTimeoutMs: number = 15_000,
  ) {}

  /** Get the next packet ID (auto-incrementing, wraps at uint32 max) */
  nextPacketId(): number {
    this._packetIdCounter = (this._packetIdCounter + 1) & 0xFFFFFFFF;
    return this._packetIdCounter;
  }

  /** Current packet ID counter value */
  get packetIdCounter(): number {
    return this._packetIdCounter;
  }

  /**
   * Track a request and return a Promise that resolves when the response arrives.
   * The Promise rejects on timeout.
   */
  track(packetId: number, command: string, timeoutMs?: number): Promise<LocoPacket> {
    return new Promise<LocoPacket>((resolve, reject) => {
      const timeout = timeoutMs ?? this.defaultTimeoutMs;

      const timer = setTimeout(() => {
        this.pending.delete(packetId);
        reject(new TimeoutError(command, packetId, timeout));
      }, timeout);

      // Don't keep the process alive just for timeouts
      if (timer.unref) {
        timer.unref();
      }

      this.pending.set(packetId, { command, resolve, reject, timer });
    });
  }

  /**
   * Resolve a pending request with the server's response packet.
   * Returns true if a matching request was found, false otherwise.
   */
  resolve(packetId: number, packet: LocoPacket): boolean {
    const entry = this.pending.get(packetId);
    if (!entry) {
      return false; // No matching request (could be a push command)
    }

    clearTimeout(entry.timer);
    this.pending.delete(packetId);
    entry.resolve(packet);
    return true;
  }

  /**
   * Reject all pending requests (e.g., on disconnect).
   */
  rejectAll(error: Error): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  /** Number of pending (in-flight) requests */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Check if a specific packetId has a pending request */
  hasPending(packetId: number): boolean {
    return this.pending.has(packetId);
  }
}
