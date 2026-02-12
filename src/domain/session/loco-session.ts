/**
 * LOCO session manager.
 * Orchestrates the connection lifecycle: CHECKIN → TLS connect → LOGINLIST → Ready.
 *
 * Responsibilities:
 *   - Booking server resolution (CHECKIN)
 *   - Main LOCO socket connection
 *   - LOGINLIST authentication
 *   - Heartbeat (PING) management
 *   - Reconnection on disconnect
 *   - Packet routing (request/response correlation + push dispatch)
 */
import { LocoSocket } from '../../transport/loco-socket';
import { resolveLocoServer, type CheckinResponse } from '../../transport/booking-client';
import { Heartbeat } from '../../transport/heartbeat';
import { ReconnectManager } from '../../transport/reconnect-manager';
import { RequestTracker } from '../../application/request-tracker';
import { LocoCommand, isPushCommand } from '../../protocol/loco-command';
import { toLong } from '../../protocol/bson-codec';
import { SessionStateMachine, SessionState } from './session-state';
import { LocoError, TransportError } from '../../types/errors';
import type { LocoPacket } from '../../protocol/loco-packet';
import type { BsonDocument } from '../../types/common';
import type { TypedEventEmitter, KakaoEvents } from '../../application/event-bus';

export interface LoginCredentials {
  /** OAuth access token from HTTP auth */
  oauthToken: string;
  /** SHA256 device UUID */
  duuid: string;
  /** User ID (from auth response) */
  userId: bigint;
  /** Device name */
  deviceName?: string;
  /** Device model */
  deviceModel?: string;
  /** Whether using sub-device */
  isSubDevice?: boolean;
  /** App version */
  appVersion?: string;
  /** OS version */
  osVersion?: string;
  /** Language */
  language?: string;
  /** Network type */
  networkType?: number;
  /** MCCMNC */
  mccmnc?: string;
}

export interface LocoSessionConfig {
  /** Heartbeat interval in ms (default: 60000) */
  heartbeatIntervalMs?: number;
  /** Heartbeat timeout in ms (default: 90000) */
  heartbeatTimeoutMs?: number;
  /** Request timeout in ms (default: 15000) */
  requestTimeoutMs?: number;
  /** Max reconnect retries (default: 10) */
  maxReconnectRetries?: number;
  /** Base reconnect delay in ms (default: 1000) */
  reconnectBaseDelayMs?: number;
}

export class LocoSession {
  private socket: LocoSocket | null = null;
  private heartbeat: Heartbeat | null = null;
  private reconnectManager: ReconnectManager;
  private stateMachine: SessionStateMachine;

  readonly requestTracker: RequestTracker;

  /** Cached CHECKIN response for reconnection */
  private lastCheckin: CheckinResponse | null = null;
  private credentials: LoginCredentials | null = null;
  private config: Required<LocoSessionConfig>;

  constructor(
    private readonly eventEmitter: TypedEventEmitter<KakaoEvents>,
    config: LocoSessionConfig = {},
  ) {
    this.config = {
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 60_000,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs ?? 90_000,
      requestTimeoutMs: config.requestTimeoutMs ?? 15_000,
      maxReconnectRetries: config.maxReconnectRetries ?? 10,
      reconnectBaseDelayMs: config.reconnectBaseDelayMs ?? 1_000,
    };

    this.requestTracker = new RequestTracker(this.config.requestTimeoutMs);

    this.stateMachine = new SessionStateMachine((from, to) => {
      this.eventEmitter.emit('session:state', to);
    });

    this.reconnectManager = new ReconnectManager(
      {
        maxRetries: this.config.maxReconnectRetries,
        baseDelayMs: this.config.reconnectBaseDelayMs,
      },
      () => this.reconnect(),
      (attempts) => {
        this.stateMachine.tryTransition(SessionState.Closed);
        this.eventEmitter.emit('error', new TransportError(
          `Gave up reconnecting after ${attempts} attempts`,
        ));
      },
    );
  }

  /** Current session state */
  get state(): SessionState {
    return this.stateMachine.state;
  }

  /** Whether session is fully operational */
  get isReady(): boolean {
    return this.stateMachine.isReady;
  }

  /**
   * Connect and authenticate.
   * Full flow: CHECKIN → TLS connect → LOGINLIST → Ready
   */
  async connect(credentials: LoginCredentials): Promise<void> {
    this.credentials = credentials;
    this.stateMachine.transition(SessionState.Connecting);

    try {
      // Step 1: Resolve LOCO server via booking
      this.lastCheckin = await resolveLocoServer({
        userId: credentials.userId,
        os: 'android',
        ntype: credentials.networkType ?? 0,
        appVer: credentials.appVersion ?? '26.1.3',
        lang: credentials.language ?? 'ko',
        useSub: credentials.isSubDevice,
        mccmnc: credentials.mccmnc,
      });

      // Step 2: Connect TLS to LOCO server
      await this.connectSocket(this.lastCheckin.host, this.lastCheckin.port);

      // Step 3: Send LOGINLIST
      this.stateMachine.transition(SessionState.Authenticating);
      await this.sendLoginList(credentials);

      // Step 4: Start heartbeat
      this.startHeartbeat();

      // Step 5: Ready
      this.stateMachine.transition(SessionState.Ready);
      this.reconnectManager.reset();
    } catch (err) {
      this.cleanup();
      this.stateMachine.tryTransition(SessionState.Disconnected);
      throw err;
    }
  }

  /**
   * Send a LOCO command and wait for the response.
   */
  async request(command: string, body: BsonDocument = {}): Promise<LocoPacket> {
    if (!this.socket?.connected) {
      throw new TransportError('Session not connected');
    }

    const packetId = this.requestTracker.nextPacketId();
    const responsePromise = this.requestTracker.track(packetId, command);

    await this.socket.sendPacket({ packetId, command, body });

    return responsePromise;
  }

  /**
   * Send a LOCO command without waiting for response (fire-and-forget).
   */
  async send(command: string, body: BsonDocument = {}): Promise<void> {
    if (!this.socket?.connected) {
      throw new TransportError('Session not connected');
    }

    const packetId = this.requestTracker.nextPacketId();
    await this.socket.sendPacket({ packetId, command, body });
  }

  /**
   * Gracefully disconnect and close the session.
   */
  async disconnect(): Promise<void> {
    this.reconnectManager.cancel();
    this.cleanup();
    this.stateMachine.tryTransition(SessionState.Closed);
    this.eventEmitter.emit('disconnected', 'user');
  }

  // ── Internal Methods ───────────────────────────────

  /** Connect the raw TLS socket and wire up event handlers */
  private async connectSocket(host: string, port: number): Promise<void> {
    this.socket = new LocoSocket(host, port);

    this.socket.on('packet', (packet: LocoPacket) => this.onPacket(packet));

    this.socket.on('error', (err: Error) => {
      this.eventEmitter.emit('error', err);
    });

    this.socket.on('close', () => {
      this.onDisconnect();
    });

    await this.socket.connect();
  }

  /** Handle incoming packet: correlate response or dispatch push */
  private onPacket(packet: LocoPacket): void {
    // Emit raw packet for debugging
    this.eventEmitter.emit('raw:packet', packet);

    // Handle PONG (PING response)
    if (packet.command === LocoCommand.PING) {
      this.heartbeat?.receivedPong();
      return;
    }

    // Try to match with a pending request
    const matched = this.requestTracker.resolve(packet.packetId, packet);

    if (!matched && isPushCommand(packet.command)) {
      // Server-initiated push — will be handled by PushHandler in Phase 3
      // For now, we just leave it for the CommandDispatcher/PushHandler to pick up
    }
  }

  /** Handle unexpected disconnection */
  private onDisconnect(): void {
    this.heartbeat?.stop();
    this.requestTracker.rejectAll(new TransportError('Connection lost'));

    if (this.stateMachine.state === SessionState.Ready) {
      this.stateMachine.tryTransition(SessionState.Reconnecting);
      this.eventEmitter.emit('disconnected', 'unexpected');
      this.reconnectManager.scheduleReconnect();
    }
  }

  /** Attempt reconnection */
  private async reconnect(): Promise<void> {
    if (!this.credentials || !this.lastCheckin) {
      throw new TransportError('Cannot reconnect: missing credentials');
    }

    this.stateMachine.tryTransition(SessionState.Connecting);

    // Re-resolve server (booking might give different server)
    this.lastCheckin = await resolveLocoServer({
      userId: this.credentials.userId,
      os: 'android',
      ntype: this.credentials.networkType ?? 0,
      appVer: this.credentials.appVersion ?? '26.1.3',
      lang: this.credentials.language ?? 'ko',
      useSub: this.credentials.isSubDevice,
    });

    await this.connectSocket(this.lastCheckin.host, this.lastCheckin.port);

    this.stateMachine.transition(SessionState.Authenticating);
    await this.sendLoginList(this.credentials);

    this.startHeartbeat();
    this.stateMachine.transition(SessionState.Ready);
  }

  /**
   * Send LOGINLIST command.
   *
   * Request body fields (from APK decompilation):
   *   - oauthToken: string   - OAuth access token
   *   - duuid: string        - Device UUID (SHA256)
   *   - os: string           - "android"
   *   - ntype: int           - Network type
   *   - appVer: string       - App version
   *   - lang: string         - Language code
   *   - prtVer: string       - Protocol version ("1")
   *   - dtype: int           - Device type (1 = mobile, 2 = sub-device)
   *   - useSub: boolean      - Sub-device flag (optional)
   *   - chatIds: long[]      - Chat room IDs to sync (empty for fresh login)
   *   - maxIds: long[]       - Max message IDs per chat room (empty for fresh)
   *   - lastTokenId: long    - Last seen token/log ID (0 for fresh)
   *   - lbk: int             - Login background kind
   *   - bg: boolean          - Background login flag
   */
  private async sendLoginList(credentials: LoginCredentials): Promise<void> {
    const body: BsonDocument = {
      oauthToken: credentials.oauthToken,
      duuid: credentials.duuid,
      os: 'android',
      ntype: credentials.networkType ?? 0,
      appVer: credentials.appVersion ?? '26.1.3',
      lang: credentials.language ?? 'ko',
      prtVer: '1',
      dtype: credentials.isSubDevice ? 2 : 1,
      chatIds: [],
      maxIds: [],
      lastTokenId: BigInt(0),
      lbk: 0,
      bg: false,
    };

    if (credentials.isSubDevice) {
      body.useSub = true;
    }

    const response = await this.request(LocoCommand.LOGINLIST, body);

    // Check for errors
    if (response.statusCode !== 0) {
      throw new LocoError(
        `LOGINLIST failed with status ${response.statusCode}`,
        LocoCommand.LOGINLIST,
        response.statusCode,
      );
    }

    // Extract userId from response and emit ready event
    const chatRooms = (response.body.chatDatas as Record<string, unknown>[]) ?? [];

    this.eventEmitter.emit('session:ready', {
      userId: credentials.userId,
      chatRooms,
    });
  }

  /** Start the PING heartbeat */
  private startHeartbeat(): void {
    this.heartbeat?.stop();

    this.heartbeat = new Heartbeat(
      this.config.heartbeatIntervalMs,
      this.config.heartbeatTimeoutMs,
      async () => {
        // Send PING command
        await this.send(LocoCommand.PING, {});
      },
      () => {
        // Heartbeat timeout → force reconnect
        this.socket?.disconnect();
      },
    );

    this.heartbeat.start();
  }

  /** Clean up all resources */
  private cleanup(): void {
    this.heartbeat?.stop();
    this.heartbeat = null;
    this.socket?.disconnect();
    this.socket = null;
    this.requestTracker.rejectAll(new TransportError('Session closed'));
  }
}
