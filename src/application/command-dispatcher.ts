/**
 * Command dispatcher for incoming LOCO packets.
 * Routes packets to the appropriate handler based on command type.
 *
 * Two routing paths:
 *   1. Request/Response: Matched by packetId via RequestTracker
 *   2. Server Push: Routed by command name to PushHandler
 */
import { isPushCommand } from '../protocol/loco-command';
import { RequestTracker } from './request-tracker';
import type { LocoPacket } from '../protocol/loco-packet';
import type { PushHandler } from './push-handler';
import type { TypedEventEmitter, KakaoEvents } from './event-bus';

export class CommandDispatcher {
  constructor(
    private readonly requestTracker: RequestTracker,
    private readonly pushHandler: PushHandler,
    private readonly eventEmitter: TypedEventEmitter<KakaoEvents>,
  ) {}

  /**
   * Dispatch an incoming packet.
   * Returns true if the packet was handled.
   */
  dispatch(packet: LocoPacket): boolean {
    // Always emit raw packet for debugging
    this.eventEmitter.emit('raw:packet', packet);

    // Try to match with a pending request first
    const matched = this.requestTracker.resolve(packet.packetId, packet);

    if (matched) {
      return true;
    }

    // If not matched, check if it's a server push
    if (isPushCommand(packet.command)) {
      this.pushHandler.handle(packet);
      return true;
    }

    // Unhandled packet — could be a response to a fire-and-forget command
    return false;
  }
}
