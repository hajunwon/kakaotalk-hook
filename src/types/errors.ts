/**
 * Error class hierarchy for the KakaoTalk client library.
 *
 * KakaoError (base)
 *   ├── AuthError         - HTTP authentication failures
 *   ├── LocoError         - LOCO command response errors (status != 0)
 *   ├── TransportError    - Socket connection errors
 *   └── TimeoutError      - Response timeout
 */

/** Base error for all library errors */
export class KakaoError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'KakaoError';
  }
}

/** HTTP-level auth failures (status code / server error) */
export class AuthError extends KakaoError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly serverMessage?: string,
    /** Server-specified view hint (e.g., 'phone-number' for signup flow) */
    public readonly view?: string,
  ) {
    super(message, 'AUTH_ERROR');
    this.name = 'AuthError';
  }
}

/** LOCO protocol-level errors (non-zero status in response) */
export class LocoError extends KakaoError {
  constructor(
    message: string,
    public readonly command: string,
    public readonly statusCode: number,
  ) {
    super(message, 'LOCO_ERROR');
    this.name = 'LocoError';
  }
}

/** Transport-level errors (socket disconnect, TLS failure) */
export class TransportError extends KakaoError {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message, 'TRANSPORT_ERROR');
    this.name = 'TransportError';
  }
}

/** Request timeout — no response within deadline */
export class TimeoutError extends KakaoError {
  constructor(
    public readonly command: string,
    public readonly packetId: number,
    public readonly timeoutMs: number,
  ) {
    super(
      `${command} (packetId=${packetId}) timed out after ${timeoutMs}ms`,
      'TIMEOUT_ERROR',
    );
    this.name = 'TimeoutError';
  }
}
