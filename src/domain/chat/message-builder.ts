/**
 * Fluent message builder for the LOCO WRITE command.
 *
 * WRITE command parameters (from Zp.C21456d.W1):
 *   chatId, clientMsgId, msg, type, noSeen, supplement, from, extra,
 *   scope (9th), threadId (10th), featureStat, isSilence
 *
 * Usage:
 *   const req = new MessageBuilder(chatId)
 *     .text("Hello!")
 *     .threadReply(threadId, true)   // scope=3 auto-set
 *     .silent()
 *     .build();
 *
 *   await session.request(LocoCommand.WRITE, req);
 */
import { ChatType } from './chat-type';
import { determineScope, ChatLogScope } from './chat-log-scope';
import type { Long, BsonDocument } from '../../types/common';

export interface WriteRequest {
  /** BSON body for the WRITE command */
  body: BsonDocument;
}

export class MessageBuilder {
  private chatId: Long;
  private msgText = '';
  private msgType: number = ChatType.Text;
  private threadId: bigint | null = null;
  private showInChatRoom = true;
  private isSilent = false;
  private noSeen = false;
  private attachmentJson: string | null = null;
  private supplementJson: string | null = null;
  private extra: string | null = null;

  constructor(chatId: Long) {
    this.chatId = chatId;
  }

  /** Set text message content */
  text(message: string): this {
    this.msgText = message;
    this.msgType = ChatType.Text;
    return this;
  }

  /** Set message type explicitly (for non-text messages) */
  type(chatType: number): this {
    this.msgType = chatType;
    return this;
  }

  /** Set as a threaded reply */
  threadReply(threadId: bigint, showInChatRoom = true): this {
    this.threadId = threadId;
    this.showInChatRoom = showInChatRoom;
    return this;
  }

  /** Mark message as silent (no notification to recipients) */
  silent(): this {
    this.isSilent = true;
    return this;
  }

  /** Mark message as "no seen" (don't mark as read) */
  hideRead(): this {
    this.noSeen = true;
    return this;
  }

  /** Set attachment JSON (for media messages) */
  attachment(json: string): this {
    this.attachmentJson = json;
    return this;
  }

  /** Set supplement JSON (for mentions, etc.) */
  supplement(json: string): this {
    this.supplementJson = json;
    return this;
  }

  /** Set extra field */
  setExtra(json: string): this {
    this.extra = json;
    return this;
  }

  /**
   * Build the WRITE command BSON body.
   *
   * Generated field mapping:
   *   chatId    → channel ID
   *   msg       → message text
   *   type      → ChatType value
   *   msgId     → client-generated unique ID
   *   noSeen    → boolean
   *   supplement→ JSON string
   *   extra     → JSON string
   *   scope     → ChatLogScope value (auto-determined from threadId)
   *   threadId  → thread ID (if threaded reply)
   *   isSilence → boolean
   */
  build(): WriteRequest {
    const scope = determineScope(this.threadId, this.showInChatRoom);

    const body: BsonDocument = {
      chatId: this.chatId,
      msg: this.msgText,
      type: this.msgType,
      msgId: this.generateClientMsgId(),
      noSeen: this.noSeen,
      scope,
    };

    if (this.supplementJson) {
      body.supplement = this.supplementJson;
    }

    if (this.attachmentJson) {
      body.extra = this.attachmentJson;
    }

    if (this.extra) {
      body.extra = this.extra;
    }

    if (this.threadId != null && this.threadId > 0n) {
      body.threadId = this.threadId;
    }

    if (this.isSilent) {
      body.isSilence = true;
    }

    return { body };
  }

  /**
   * Generate a client-side message ID.
   * This is used for deduplication — the server assigns the real logId.
   * Uses current time in milliseconds as a simple unique ID.
   */
  private generateClientMsgId(): bigint {
    return BigInt(Date.now());
  }
}
