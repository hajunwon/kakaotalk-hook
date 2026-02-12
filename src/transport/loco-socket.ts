/**
 * LOCO socket transport.
 * Handles TLS connection, frame-level binary I/O, and packet accumulation.
 *
 * Emits:
 *   - 'packet': Complete LocoPacket decoded from the stream
 *   - 'error': Transport error
 *   - 'close': Connection closed
 *   - 'connect': Connection established
 */
import { EventEmitter } from 'node:events';
import * as tls from 'node:tls';
import { HEADER_SIZE } from '../protocol/loco-header';
import {
  encodePacket,
  tryDecodePacket,
  type LocoPacket,
  type LocoRequestInput,
} from '../protocol/loco-packet';
import { TransportError } from '../types/errors';
import type { BsonDocument } from '../types/common';

export interface LocoSocketEvents {
  packet: (packet: LocoPacket) => void;
  error: (err: Error) => void;
  close: () => void;
  connect: () => void;
}

export class LocoSocket extends EventEmitter {
  private socket: tls.TLSSocket | null = null;
  private readBuffer: Buffer = Buffer.alloc(0);
  private _connected = false;

  constructor(
    private host: string,
    private port: number,
  ) {
    super();
  }

  /** Whether the underlying TLS socket is connected */
  get connected(): boolean {
    return this._connected;
  }

  /** Establish TLS connection to the LOCO server */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket) {
        this.disconnect();
      }

      this.readBuffer = Buffer.alloc(0);

      this.socket = tls.connect(
        {
          host: this.host,
          port: this.port,
          // KakaoTalk's LOCO server may use self-signed or non-standard certs
          rejectUnauthorized: false,
        },
        () => {
          this._connected = true;
          this.emit('connect');
          resolve();
        },
      );

      this.socket.on('data', (chunk: Buffer) => this.onData(chunk));

      this.socket.on('error', (err: Error) => {
        const transportErr = new TransportError(`Socket error: ${err.message}`, err);
        if (!this._connected) {
          reject(transportErr);
        } else {
          this.emit('error', transportErr);
        }
      });

      this.socket.on('close', () => {
        this._connected = false;
        this.emit('close');
      });

      this.socket.on('end', () => {
        this._connected = false;
      });
    });
  }

  /** Send a raw LOCO packet */
  async sendPacket(input: LocoRequestInput): Promise<void> {
    if (!this.socket || !this._connected) {
      throw new TransportError('Socket not connected');
    }

    const buf = encodePacket(input);

    return new Promise((resolve, reject) => {
      this.socket!.write(buf, (err) => {
        if (err) {
          reject(new TransportError(`Write failed: ${err.message}`, err));
        } else {
          resolve();
        }
      });
    });
  }

  /** Gracefully close the connection */
  disconnect(): void {
    this._connected = false;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.readBuffer = Buffer.alloc(0);
  }

  /** Accumulate incoming data and parse complete packets */
  private onData(chunk: Buffer): void {
    this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
    this.parsePackets();
  }

  /** Extract complete packets from the read buffer */
  private parsePackets(): void {
    while (this.readBuffer.length >= HEADER_SIZE) {
      const result = tryDecodePacket(this.readBuffer);

      if (!result) {
        // Not enough data for a complete packet yet
        break;
      }

      // Consume the parsed bytes
      this.readBuffer = this.readBuffer.subarray(result.bytesConsumed);

      // Emit the complete packet
      this.emit('packet', result.packet);
    }
  }
}
