/**
 * Booking client for resolving the LOCO server address.
 *
 * Flow:
 *   1. Connect TLS to booking-loco.kakao.com:443
 *   2. Send CHECKIN command with userId, os, appVersion, etc.
 *   3. Receive response with LOCO server host:port
 *   4. Disconnect from booking server
 *   5. Return { host, port } for main LOCO connection
 *
 * CHECKIN request body (BSON):
 *   { userId, os, ntype, appVer, lang, useSub?, MCCMNC? }
 *
 * CHECKIN response body (BSON):
 *   { host, host6, port, cacheExpire, vsshost, vsshost6, vssport }
 */
import { LocoSocket } from './loco-socket';
import { LocoCommand } from '../protocol/loco-command';
import { toLong } from '../protocol/bson-codec';
import { TransportError } from '../types/errors';
import type { LocoPacket } from '../protocol/loco-packet';

export const BOOKING_HOST = 'booking-loco.kakao.com';
export const BOOKING_PORT = 443;

export interface CheckinRequest {
  /** Logged-in user ID */
  userId: bigint;
  /** OS identifier (default: 'android') */
  os?: string;
  /** Network type: 0=unknown, 1=wifi, 2=cellular (default: 0) */
  ntype?: number;
  /** App version string (default: '26.1.3') */
  appVer?: string;
  /** Language code (default: 'ko') */
  lang?: string;
  /** Whether using sub-device login */
  useSub?: boolean;
  /** Mobile Country Code + Mobile Network Code */
  mccmnc?: string;
}

export interface CheckinResponse {
  /** LOCO server hostname (IPv4) */
  host: string;
  /** LOCO server hostname (IPv6) */
  host6: string;
  /** LOCO server port */
  port: number;
  /** Cache expiration (seconds?) */
  cacheExpire: number;
  /** Voice server hostname */
  vssHost: string;
  /** Voice server hostname (IPv6) */
  vssHost6: string;
  /** Voice server port */
  vssPort: number;
}

/**
 * Resolve the LOCO server address via the booking server.
 *
 * Connects to booking-loco.kakao.com:443, sends CHECKIN,
 * and returns the real LOCO server address.
 */
export async function resolveLocoServer(
  request: CheckinRequest,
): Promise<CheckinResponse> {
  const socket = new LocoSocket(BOOKING_HOST, BOOKING_PORT);

  try {
    await socket.connect();

    // Build CHECKIN request body
    const body: Record<string, unknown> = {
      userId: request.userId,
      os: request.os ?? 'android',
      ntype: request.ntype ?? 0,
      appVer: request.appVer ?? '26.1.3',
      lang: request.lang ?? 'ko',
    };

    if (request.useSub) {
      body.useSub = true;
    }

    if (request.mccmnc) {
      body.MCCMNC = request.mccmnc;
    }

    // Send CHECKIN and wait for response
    const response = await sendAndWait(socket, LocoCommand.CHECKIN, body);

    // Parse response
    const responseBody = response.body;
    return {
      host: String(responseBody.host ?? ''),
      host6: String(responseBody.host6 ?? ''),
      port: Number(responseBody.port ?? 0),
      cacheExpire: Number(responseBody.cacheExpire ?? 0),
      vssHost: String(responseBody.vsshost ?? ''),
      vssHost6: String(responseBody.vsshost6 ?? ''),
      vssPort: Number(responseBody.vssport ?? 0),
    };
  } finally {
    socket.disconnect();
  }
}

/**
 * Send a single LOCO command and wait for the response.
 * Used for booking server one-shot interactions.
 */
function sendAndWait(
  socket: LocoSocket,
  command: string,
  body: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<LocoPacket> {
  return new Promise<LocoPacket>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TransportError(`Booking ${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once('packet', (packet: LocoPacket) => {
      clearTimeout(timer);
      resolve(packet);
    });

    socket.once('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });

    socket.sendPacket({
      packetId: 1,
      command,
      body,
    }).catch((err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
