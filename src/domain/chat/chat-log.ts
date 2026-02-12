/**
 * ChatLog model.
 * Represents a single message in the KakaoTalk LOCO protocol.
 * Derived from decompilation of eq.ChatLog.
 *
 * BSON field mapping (from MSG push / WRITE response):
 *   logId     → chatLog.logId
 *   msgId     → chatLog.msgId  (client-generated unique ID)
 *   chatId    → chatLog.chatId (channel/room ID)
 *   prevId    → chatLog.prevId (previous message logId)
 *   type      → chatLog.type   (ChatType enum value)
 *   authorId  → chatLog.authorId (sender user ID)
 *   message   → chatLog.message  (text body)
 *   sendAt    → chatLog.sendAt   (unix timestamp in seconds)
 *   attachment→ chatLog.attachment (JSON string for media)
 *   supplement→ chatLog.supplement (JSON string, e.g., mentions)
 *   referer   → chatLog.referer
 *   revision  → chatLog.revision
 *   scope     → chatLog.scope    (ChatLogScope bitmask)
 *   threadId  → chatLog.threadId (thread ID for threaded replies)
 *   msgTtl    → chatLog.msgTtl   (message TTL for disappearing msgs)
 */
import { toLong } from '../../protocol/bson-codec';
import type { Long, Timestamp } from '../../types/common';
import type { ChatType } from './chat-type';
import type { ChatLogScope } from './chat-log-scope';

export interface ChatLog {
  /** Server-assigned log ID (monotonically increasing per channel) */
  logId: Long;
  /** Client-generated message ID */
  msgId: Long;
  /** Channel (chat room) ID */
  chatId: Long;
  /** Previous message's logId in this channel */
  prevId: Long;
  /** Message type (ChatType enum value) */
  type: number;
  /** Sender's user ID */
  authorId: Long;
  /** Text content of the message */
  message: string;
  /** Unix timestamp in seconds when message was sent */
  sendAt: Timestamp;
  /** JSON-encoded attachment data (structure varies by type) */
  attachment?: string;
  /** JSON-encoded supplement data (mentions, etc.) */
  supplement?: string;
  /** Referrer information */
  referer?: string;
  /** Message revision number */
  revision?: number;
  /** Visibility scope (ChatLogScope bitmask) */
  scope?: number;
  /** Thread ID (for threaded replies) */
  threadId?: Long;
  /** Message TTL in seconds (for disappearing messages) */
  msgTtl?: number;
}

/**
 * Parse a BSON document (from MSG push or WRITE response) into a ChatLog.
 * Handles both the `chatLog` wrapper object and flat body formats.
 */
export function parseChatLog(body: Record<string, unknown>): ChatLog {
  // MSG push wraps in a `chatLog` field; WRITE response may be flat
  const src = (body.chatLog as Record<string, unknown>) ?? body;

  return {
    logId: toLong(src.logId),
    msgId: toLong(src.msgId),
    chatId: toLong(src.chatId),
    prevId: toLong(src.prevId),
    type: Number(src.type ?? 0),
    authorId: toLong(src.authorId),
    message: String(src.message ?? ''),
    sendAt: Number(src.sendAt ?? 0),
    attachment: src.attachment != null ? String(src.attachment) : undefined,
    supplement: src.supplement != null ? String(src.supplement) : undefined,
    referer: src.referer != null ? String(src.referer) : undefined,
    revision: src.revision != null ? Number(src.revision) : undefined,
    scope: src.scope != null ? Number(src.scope) : undefined,
    threadId: src.threadId != null ? toLong(src.threadId) : undefined,
    msgTtl: src.msgTtl != null ? Number(src.msgTtl) : undefined,
  };
}
