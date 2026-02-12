/**
 * Server push handler.
 * Processes unsolicited messages from the LOCO server and emits typed events.
 *
 * Push commands have no matching request packetId — they are server-initiated.
 * Examples: MSG (new message), NEWMEM (member joined), LEFT (member left),
 *           KICKED (kicked from room), CHANGESVR (server migration).
 */
import { LocoCommand } from '../protocol/loco-command';
import { toLong } from '../protocol/bson-codec';
import { parseChatLog } from '../domain/chat/chat-log';
import type { LocoPacket } from '../protocol/loco-packet';
import type {
  TypedEventEmitter,
  KakaoEvents,
  MessageEvent,
  MemberEvent,
  KickedEvent,
  ServerChangeEvent,
} from './event-bus';

export class PushHandler {
  constructor(
    private readonly eventEmitter: TypedEventEmitter<KakaoEvents>,
  ) {}

  /**
   * Handle a server push packet.
   * Routes to the appropriate typed event based on the command.
   */
  handle(packet: LocoPacket): void {
    switch (packet.command) {
      case LocoCommand.MSG:
        this.handleMessage(packet);
        break;

      case LocoCommand.NEWMEM:
        this.handleNewMember(packet);
        break;

      case LocoCommand.LEFT:
        this.handleMemberLeft(packet);
        break;

      case LocoCommand.KICKED:
      case LocoCommand.KICKOUT:
        this.handleKicked(packet);
        break;

      case LocoCommand.CHANGESVR:
        this.handleServerChange(packet);
        break;

      case LocoCommand.DECUNREAD:
        // Read receipt — could add event later
        break;

      case LocoCommand.SYNCMSG:
      case LocoCommand.SYNCNEWMSG:
        // Sync messages — treat similar to MSG
        this.handleMessage(packet);
        break;

      case LocoCommand.SYNCDLMSG:
        // Deleted message sync
        break;

      case LocoCommand.SYNCMODMSG:
        // Modified message sync (e.g., edited message)
        break;

      case LocoCommand.SYNCCREATE:
        // New chat room created
        break;

      case LocoCommand.SYNCJOIN:
        // Joined a chat room
        break;

      default:
        // Unhandled push — silent ignore
        break;
    }
  }

  /** Handle MSG push: new incoming message */
  private handleMessage(packet: LocoPacket): void {
    const body = packet.body as Record<string, unknown>;
    const chatLog = parseChatLog(body);

    const event: MessageEvent = {
      logId: chatLog.logId,
      chatId: chatLog.chatId,
      authorId: chatLog.authorId,
      type: chatLog.type,
      message: chatLog.message,
      sendAt: chatLog.sendAt,
      attachment: chatLog.attachment,
      supplement: chatLog.supplement,
      scope: chatLog.scope,
      threadId: chatLog.threadId,
      raw: body,
    };

    this.eventEmitter.emit('message', event);
  }

  /** Handle NEWMEM push: new member joined a channel */
  private handleNewMember(packet: LocoPacket): void {
    const body = packet.body as Record<string, unknown>;
    const chatId = toLong(body.chatId);

    // Member IDs may be in `members` array
    const memberIds: bigint[] = [];
    const members = body.members as unknown[];
    if (Array.isArray(members)) {
      for (const m of members) {
        if (typeof m === 'object' && m !== null) {
          const member = m as Record<string, unknown>;
          memberIds.push(toLong(member.userId));
        }
      }
    }

    const event: MemberEvent = {
      chatId,
      memberIds,
      raw: body,
    };

    this.eventEmitter.emit('member:join', event);
  }

  /** Handle LEFT push: member left a channel */
  private handleMemberLeft(packet: LocoPacket): void {
    const body = packet.body as Record<string, unknown>;
    const chatId = toLong(body.chatId);

    const memberIds: bigint[] = [];
    if (body.userId != null) {
      memberIds.push(toLong(body.userId));
    }

    const event: MemberEvent = {
      chatId,
      memberIds,
      raw: body,
    };

    this.eventEmitter.emit('member:left', event);
  }

  /** Handle KICKED/KICKOUT push */
  private handleKicked(packet: LocoPacket): void {
    const body = packet.body as Record<string, unknown>;

    const event: KickedEvent = {
      chatId: toLong(body.chatId),
      raw: body,
    };

    this.eventEmitter.emit('kicked', event);
  }

  /** Handle CHANGESVR push: server migration */
  private handleServerChange(packet: LocoPacket): void {
    const body = packet.body as Record<string, unknown>;

    const event: ServerChangeEvent = {
      host: String(body.host ?? ''),
      port: Number(body.port ?? 0),
    };

    this.eventEmitter.emit('server:change', event);
  }
}
