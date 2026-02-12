/**
 * LOCO packet encoding/decoding.
 * Combines the 22-byte header with BSON body serialization.
 */
import type { Document } from 'bson';
import type { BsonDocument } from '../types/common';
import {
  HEADER_SIZE,
  BODY_TYPE_BSON,
  encodeHeader,
  decodeHeader,
  type LocoHeader,
} from './loco-header';
import { serialize, deserialize } from './bson-codec';

export interface LocoPacket {
  /** Auto-incrementing packet identifier */
  packetId: number;
  /** Response status code (0 for requests, server sets for responses) */
  statusCode: number;
  /** LOCO command name (e.g., "LOGINLIST", "WRITE", "MSG") */
  command: string;
  /** Deserialized BSON body */
  body: Document;
}

/** Encode request fields (no statusCode needed) */
export interface LocoRequestInput {
  packetId: number;
  command: string;
  body: BsonDocument;
}

/**
 * Encode a LOCO request packet into a Buffer.
 * Format: [22-byte header][BSON body]
 */
export function encodePacket(input: LocoRequestInput): Buffer {
  const bodyBuf = serialize(input.body);

  const header = encodeHeader({
    packetId: input.packetId,
    statusCode: 0,
    command: input.command,
    bodyType: BODY_TYPE_BSON,
    bodySize: bodyBuf.length,
  });

  return Buffer.concat([header, bodyBuf]);
}

/**
 * Try to decode a complete LOCO packet from the beginning of a buffer.
 *
 * Returns:
 *   - { packet, bytesConsumed } if a complete packet is available
 *   - null if the buffer doesn't contain a complete packet yet
 */
export function tryDecodePacket(
  buf: Buffer,
): { packet: LocoPacket; bytesConsumed: number } | null {
  // Need at least the header
  if (buf.length < HEADER_SIZE) {
    return null;
  }

  const header = decodeHeader(buf);
  const totalSize = HEADER_SIZE + header.bodySize;

  // Need the full body
  if (buf.length < totalSize) {
    return null;
  }

  const bodyBuf = buf.subarray(HEADER_SIZE, totalSize);
  const body = header.bodySize > 0 ? deserialize(bodyBuf) : {};

  return {
    packet: {
      packetId: header.packetId,
      statusCode: header.statusCode,
      command: header.command,
      body,
    },
    bytesConsumed: totalSize,
  };
}
