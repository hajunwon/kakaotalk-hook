/**
 * Type-safe EventEmitter for the KakaoTalk client.
 * Provides strongly-typed event subscriptions and emissions.
 */
import { EventEmitter } from 'node:events';
import type { LocoPacket } from '../protocol/loco-packet';

// ── Event Definitions ─────────────────────────────

/** All events emitted by KakaoClient */
export interface KakaoEvents {
  /** Incoming message (server push: MSG command) */
  'message': (data: MessageEvent) => void;
  /** Message sent confirmation (WRITE response) */
  'message:sent': (data: MessageSentEvent) => void;
  /** New member joined a channel (NEWMEM push) */
  'member:join': (data: MemberEvent) => void;
  /** Member left a channel (LEFT push) */
  'member:left': (data: MemberEvent) => void;
  /** Kicked from a channel (KICKED push) */
  'kicked': (data: KickedEvent) => void;
  /** Session state changed */
  'session:state': (state: string) => void;
  /** Session fully ready (LOGINLIST succeeded) */
  'session:ready': (data: SessionReadyEvent) => void;
  /** Error occurred */
  'error': (err: Error) => void;
  /** Raw LOCO packet (for debugging) */
  'raw:packet': (packet: LocoPacket) => void;
  /** Connection closed */
  'disconnected': (reason: string) => void;
  /** Server requested reconnection (CHANGESVR push) */
  'server:change': (data: ServerChangeEvent) => void;
}

// ── Event Data Types ──────────────────────────────

export interface MessageEvent {
  /** Chat log ID */
  logId: bigint;
  /** Channel (chat room) ID */
  chatId: bigint;
  /** Sender user ID */
  authorId: bigint;
  /** Message type (1=text, 2=photo, etc.) */
  type: number;
  /** Message text content */
  message: string;
  /** Unix timestamp (seconds) */
  sendAt: number;
  /** Attachment JSON (if media message) */
  attachment?: string;
  /** Supplement JSON (e.g., mentions) */
  supplement?: string;
  /** Thread scope (1=chatroom, 2=thread, 3=both) */
  scope?: number;
  /** Thread ID (if threaded reply) */
  threadId?: bigint;
  /** Raw BSON body for advanced usage */
  raw: Record<string, unknown>;
}

export interface MessageSentEvent {
  /** Chat log ID assigned by server */
  logId: bigint;
  /** Channel ID */
  chatId: bigint;
  /** Message ID (client-generated) */
  msgId: bigint;
  /** Sent timestamp */
  sendAt: number;
  /** Raw BSON body */
  raw: Record<string, unknown>;
}

export interface MemberEvent {
  /** Channel ID */
  chatId: bigint;
  /** Member user IDs */
  memberIds: bigint[];
  /** Raw BSON body */
  raw: Record<string, unknown>;
}

export interface KickedEvent {
  /** Channel ID */
  chatId: bigint;
  /** Raw BSON body */
  raw: Record<string, unknown>;
}

export interface SessionReadyEvent {
  /** User ID of the logged-in user */
  userId: bigint;
  /** Chat room list from LOGINLIST response */
  chatRooms: Record<string, unknown>[];
}

export interface ServerChangeEvent {
  /** New server host */
  host: string;
  /** New server port */
  port: number;
}

// ── Typed EventEmitter ────────────────────────────

/**
 * Strongly-typed EventEmitter.
 * Extends Node's EventEmitter with generic type parameter for event map.
 */
export class TypedEventEmitter<T extends { [K in keyof T]: (...args: any[]) => void } = KakaoEvents> extends EventEmitter {
  override on<K extends keyof T & string>(event: K, listener: T[K]): this {
    return super.on(event, listener as (...args: any[]) => void);
  }

  override once<K extends keyof T & string>(event: K, listener: T[K]): this {
    return super.once(event, listener as (...args: any[]) => void);
  }

  override off<K extends keyof T & string>(event: K, listener: T[K]): this {
    return super.off(event, listener as (...args: any[]) => void);
  }

  override emit<K extends keyof T & string>(event: K, ...args: Parameters<T[K]>): boolean {
    return super.emit(event, ...args);
  }

  override removeAllListeners<K extends keyof T & string>(event?: K): this {
    return super.removeAllListeners(event);
  }
}
