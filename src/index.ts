/**
 * KakaoTalk LOCO Client Library
 *
 * A TypeScript implementation of the KakaoTalk LOCO protocol,
 * reverse-engineered from the Android APK.
 *
 * @example
 * ```typescript
 * import { KakaoClient, MessageBuilder } from 'kakaotalk-hook';
 *
 * const client = new KakaoClient();
 *
 * client.on('message', (event) => {
 *   console.log(`[${event.chatId}] ${event.authorId}: ${event.message}`);
 * });
 *
 * // Login with token
 * await client.loginWithToken({
 *   oauthToken: 'your-access-token',
 *   userId: 12345n,
 *   duuid: 'your-device-uuid',
 * });
 *
 * // Send a message
 * await client.sendMessage(chatId, 'Hello from TS!');
 *
 * // Advanced: threaded reply
 * const msg = new MessageBuilder(chatId)
 *   .text('Replying to thread')
 *   .threadReply(threadId, true)
 *   .build();
 * await client.send(msg);
 * ```
 */

// ── Main Client ─────────────────────────────────────
export {
  KakaoClient,
  type KakaoClientOptions,
  type EmailLoginOptions,
  type TokenLoginOptions,
} from './client';

// ── Events ──────────────────────────────────────────
export {
  TypedEventEmitter,
  type KakaoEvents,
  type MessageEvent,
  type MessageSentEvent,
  type MemberEvent,
  type KickedEvent,
  type SessionReadyEvent,
  type ServerChangeEvent,
} from './application/event-bus';

// ── Chat Domain ─────────────────────────────────────
export {
  MessageBuilder,
  type WriteRequest,
} from './domain/chat/message-builder';

export {
  ChatType,
  isMediaType,
  chatTypeName,
} from './domain/chat/chat-type';

export {
  ChatLogScope,
  isVisibleInChatRoom,
  isVisibleInThreadDetail,
  determineScope,
} from './domain/chat/chat-log-scope';

export {
  parseChatLog,
  type ChatLog,
} from './domain/chat/chat-log';

// ── Session ─────────────────────────────────────────
export {
  SessionState,
} from './domain/session/session-state';

export type {
  LoginCredentials,
  LocoSessionConfig,
} from './domain/session/loco-session';

// ── Protocol ────────────────────────────────────────
export { LocoCommand, isPushCommand, PUSH_COMMANDS } from './protocol/loco-command';
export type { LocoPacket, LocoRequestInput } from './protocol/loco-packet';
export type { LocoHeader } from './protocol/loco-header';
export { serialize, deserialize, toLong } from './protocol/bson-codec';

// ── Transport ───────────────────────────────────────
export { resolveLocoServer, type CheckinRequest, type CheckinResponse } from './transport/booking-client';

// ── Crypto / Device ─────────────────────────────────
export {
  createDeviceUUID,
  hashAndroidId,
  encryptPassword,
  generateXVCKey,
  buildUserAgent,
  buildDeviceInfoHeader,
  createDeviceConfig,
  type DeviceConfig,
  type DeviceConfigOptions,
} from './protocol/crypto';

// ── Errors ──────────────────────────────────────────
export {
  KakaoError,
  AuthError,
  LocoError,
  TransportError,
  TimeoutError,
} from './types/errors';

// ── Types ───────────────────────────────────────────
export type { Long, Timestamp, TimestampMs, PacketId, BsonDocument } from './types/common';

// ── Auth (HTTP layer) ───────────────────────────────
export {
  login,
  loginPrimary,
  loginSubDevice,
  generatePassCode,
  registerDevice,
  pollRegisterDevice,
  authorizePassCode,
  cancelPassCode,
  getPassCodeInfo,
  registerAndLoginSubDevice,
  loginPrimaryDevice,
} from './auth';

export type { SignUpData, OAuth2Token, PhoneNumber } from './auth';
