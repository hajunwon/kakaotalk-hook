/**
 * KakaoClient — the top-level orchestrator for the KakaoTalk LOCO client.
 *
 * Usage:
 *   const client = new KakaoClient();
 *
 *   client.on('message', (event) => {
 *     console.log(`${event.authorId}: ${event.message}`);
 *   });
 *
 *   // Option A: Direct token login (if you already have tokens)
 *   await client.loginWithToken({
 *     oauthToken: 'xxx',
 *     userId: 12345n,
 *     duuid: 'sha256-device-uuid',
 *   });
 *
 *   // Option B: Full email/password login
 *   await client.login({
 *     mode: 'primary',
 *     email: 'user@example.com',
 *     password: 'pass',
 *   });
 *
 *   // Send a message
 *   await client.sendMessage(chatId, 'Hello!');
 *
 *   // Fluent builder for advanced messages
 *   const req = new MessageBuilder(chatId)
 *     .text('Reply!')
 *     .threadReply(threadId, true)
 *     .silent()
 *     .build();
 *   await client.send(req);
 *
 *   await client.disconnect();
 */
import { TypedEventEmitter, type KakaoEvents } from './application/event-bus';
import { CommandDispatcher } from './application/command-dispatcher';
import { PushHandler } from './application/push-handler';
import { LocoSession, type LoginCredentials, type LocoSessionConfig } from './domain/session/loco-session';
import { SessionState } from './domain/session/session-state';
import { MessageBuilder, type WriteRequest } from './domain/chat/message-builder';
import { ChatType } from './domain/chat/chat-type';
import { parseChatLog, type ChatLog } from './domain/chat/chat-log';
import { LocoCommand } from './protocol/loco-command';
import { toLong } from './protocol/bson-codec';
import { createDeviceConfig, type DeviceConfig, type DeviceConfigOptions } from './protocol/crypto';
import { LocoError, TransportError, AuthError } from './types/errors';
import type { Long, BsonDocument } from './types/common';
import type { LocoPacket } from './protocol/loco-packet';

// Re-export auth functions for convenience
import {
  login as httpLogin,
  loginPrimaryDevice,
  registerAndLoginSubDevice,
  type SignUpData,
} from './auth';

// ── Client Options ──────────────────────────────────

export interface KakaoClientOptions {
  /** Device configuration options */
  device?: DeviceConfigOptions;
  /** Session configuration */
  session?: LocoSessionConfig;
}

export interface EmailLoginOptions {
  /** Login mode: 'primary' (main device) or 'sub' (sub-device) */
  mode: 'primary' | 'sub';
  /** Account email/ID */
  email: string;
  /** Account password */
  password: string;
  /** Android ID for device generation (optional) */
  androidId?: string;
  /** Sub-device options */
  subOptions?: {
    passcode?: string;
    forced?: boolean;
    permanent?: boolean;
    autoLogin?: boolean;
  };
}

export interface TokenLoginOptions {
  /** OAuth access token */
  oauthToken: string;
  /** User ID */
  userId: bigint;
  /** Device UUID (SHA256) */
  duuid: string;
  /** Whether this is a sub-device */
  isSubDevice?: boolean;
  /** App version override */
  appVersion?: string;
  /** Language override */
  language?: string;
}

// ── KakaoClient ─────────────────────────────────────

export class KakaoClient extends TypedEventEmitter<KakaoEvents> {
  private session: LocoSession;
  private pushHandler: PushHandler;
  private dispatcher: CommandDispatcher;
  private deviceConfig: DeviceConfig | null = null;

  constructor(options: KakaoClientOptions = {}) {
    super();

    // Create session (internally creates RequestTracker)
    this.session = new LocoSession(this, options.session);

    // Create push handler (dispatches server pushes to events)
    this.pushHandler = new PushHandler(this);

    // Create command dispatcher (routes packets)
    this.dispatcher = new CommandDispatcher(
      this.session.requestTracker,
      this.pushHandler,
      this,
    );
  }

  /** Current session state */
  get state(): SessionState {
    return this.session.state;
  }

  /** Whether the client is fully connected and ready */
  get isReady(): boolean {
    return this.session.isReady;
  }

  // ── Login Methods ─────────────────────────────────

  /**
   * Login with email and password.
   * Performs HTTP authentication first, then LOCO connection.
   *
   * For primary login: POST /android/account2/login (JSON, plain password)
   * For sub-device: POST /android/account/login.json (form, AES password)
   */
  async login(options: EmailLoginOptions): Promise<SignUpData> {
    // Generate device config
    this.deviceConfig = createDeviceConfig({
      androidId: options.androidId,
    });

    // HTTP auth
    const result = await httpLogin(
      options.mode,
      options.email,
      options.password,
      {
        duuid: this.deviceConfig.duuid,
        ssaid: this.deviceConfig.ssaid,
        model: this.deviceConfig.model,
      },
      options.subOptions,
    );

    if (!result.success) {
      throw new AuthError(
        `Login failed: ${'error' in result ? JSON.stringify(result.error) : 'unknown'}`,
        -1,
      );
    }

    // Now connect LOCO with the obtained token
    await this.session.connect({
      oauthToken: result.accessToken,
      duuid: this.deviceConfig.duuid,
      userId: result.signUpData.userId,
      deviceModel: this.deviceConfig.model,
      isSubDevice: options.mode === 'sub',
      appVersion: this.deviceConfig.appVersion,
      osVersion: this.deviceConfig.osVersion,
      language: this.deviceConfig.language,
    });

    return result.signUpData;
  }

  /**
   * Login with an existing OAuth token.
   * Skips HTTP auth and goes directly to LOCO connection.
   */
  async loginWithToken(options: TokenLoginOptions): Promise<void> {
    await this.session.connect({
      oauthToken: options.oauthToken,
      duuid: options.duuid,
      userId: options.userId,
      isSubDevice: options.isSubDevice,
      appVersion: options.appVersion,
      language: options.language,
    });
  }

  // ── Messaging ─────────────────────────────────────

  /**
   * Send a simple text message to a chat room.
   */
  async sendMessage(chatId: Long, text: string): Promise<ChatLog> {
    const req = new MessageBuilder(chatId).text(text).build();
    return this.send(req);
  }

  /**
   * Send a message using a WriteRequest (from MessageBuilder).
   */
  async send(request: WriteRequest): Promise<ChatLog> {
    const response = await this.session.request(LocoCommand.WRITE, request.body);

    if (response.statusCode !== 0) {
      throw new LocoError(
        `WRITE failed with status ${response.statusCode}`,
        LocoCommand.WRITE,
        response.statusCode,
      );
    }

    const chatLog = parseChatLog(response.body as Record<string, unknown>);

    // Emit sent confirmation
    this.emit('message:sent', {
      logId: chatLog.logId,
      chatId: chatLog.chatId,
      msgId: chatLog.msgId,
      sendAt: chatLog.sendAt,
      raw: response.body as Record<string, unknown>,
    });

    return chatLog;
  }

  // ── Chat Room Operations ──────────────────────────

  /**
   * Mark messages as read in a chat room.
   */
  async markRead(chatId: Long, logId: Long): Promise<void> {
    await this.session.request(LocoCommand.DECUNREAD, {
      chatId,
      watermark: logId,
    });
  }

  /**
   * Get chat room info.
   */
  async getChatInfo(chatId: Long): Promise<LocoPacket> {
    return this.session.request(LocoCommand.CHATINFO, { chatId });
  }

  /**
   * Get channel member list.
   */
  async getMembers(chatId: Long): Promise<LocoPacket> {
    return this.session.request(LocoCommand.GETMEM, { chatId });
  }

  // ── Raw LOCO Commands ─────────────────────────────

  /**
   * Send a raw LOCO command and wait for response.
   * For advanced usage when specific commands are not yet wrapped.
   */
  async rawRequest(command: string, body: BsonDocument = {}): Promise<LocoPacket> {
    return this.session.request(command, body);
  }

  /**
   * Send a raw LOCO command without waiting for response.
   */
  async rawSend(command: string, body: BsonDocument = {}): Promise<void> {
    return this.session.send(command, body);
  }

  // ── Lifecycle ─────────────────────────────────────

  /**
   * Gracefully disconnect from the LOCO server.
   */
  async disconnect(): Promise<void> {
    await this.session.disconnect();
  }
}
