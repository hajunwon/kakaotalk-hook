/**
 * LOCO protocol header encoding/decoding.
 *
 * Header format (22 bytes):
 *   [packetId:  uint32LE]  4 bytes - auto-incrementing packet identifier
 *   [statusCode: int16LE]  2 bytes - status (0 for requests, response status)
 *   [command:   11 bytes]  11 bytes - null-padded ASCII command name
 *   [bodyType:   uint8  ]  1 byte  - body encoding type (0 = BSON)
 *   [bodySize:  uint32LE]  4 bytes - body length in bytes
 *   ────────────────────────────────
 *   Total: 22 bytes
 */

export const HEADER_SIZE = 22;
export const COMMAND_FIELD_SIZE = 11;
export const BODY_TYPE_BSON = 0;

export interface LocoHeader {
  packetId: number;
  statusCode: number;
  command: string;
  bodyType: number;
  bodySize: number;
}

/**
 * Encode a LOCO header into a 22-byte Buffer.
 */
export function encodeHeader(header: LocoHeader): Buffer {
  const buf = Buffer.alloc(HEADER_SIZE);
  let offset = 0;

  // packetId: uint32LE
  buf.writeUInt32LE(header.packetId, offset);
  offset += 4;

  // statusCode: int16LE
  buf.writeInt16LE(header.statusCode, offset);
  offset += 2;

  // command: 11 bytes, null-padded ASCII
  const cmdBuf = Buffer.alloc(COMMAND_FIELD_SIZE, 0);
  Buffer.from(header.command, 'ascii').copy(cmdBuf, 0, 0, Math.min(header.command.length, COMMAND_FIELD_SIZE));
  cmdBuf.copy(buf, offset);
  offset += COMMAND_FIELD_SIZE;

  // bodyType: uint8
  buf.writeUInt8(header.bodyType, offset);
  offset += 1;

  // bodySize: uint32LE
  buf.writeUInt32LE(header.bodySize, offset);

  return buf;
}

/**
 * Decode a LOCO header from a Buffer (must be at least 22 bytes).
 */
export function decodeHeader(buf: Buffer): LocoHeader {
  if (buf.length < HEADER_SIZE) {
    throw new Error(`Buffer too small for LOCO header: ${buf.length} < ${HEADER_SIZE}`);
  }

  let offset = 0;

  const packetId = buf.readUInt32LE(offset);
  offset += 4;

  const statusCode = buf.readInt16LE(offset);
  offset += 2;

  // Command: read 11 bytes, trim null padding
  const cmdBytes = buf.subarray(offset, offset + COMMAND_FIELD_SIZE);
  const nullIdx = cmdBytes.indexOf(0);
  const command = cmdBytes.subarray(0, nullIdx === -1 ? COMMAND_FIELD_SIZE : nullIdx).toString('ascii');
  offset += COMMAND_FIELD_SIZE;

  const bodyType = buf.readUInt8(offset);
  offset += 1;

  const bodySize = buf.readUInt32LE(offset);

  return { packetId, statusCode, command, bodyType, bodySize };
}
