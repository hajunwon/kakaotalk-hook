/**
 * BSON codec wrapper for LOCO protocol body serialization.
 * LOCO packets use BSON (bodyType=0) for their payload.
 */
import { BSON, type Document, Long as BsonLong } from 'bson';
import type { BsonDocument } from '../types/common';

/**
 * Serialize a JavaScript object to BSON bytes.
 * Automatically converts bigint values to BSON Long.
 */
export function serialize(doc: BsonDocument): Buffer {
  return Buffer.from(BSON.serialize(convertBigIntsToLong(doc) as Document));
}

/**
 * Deserialize BSON bytes to a JavaScript object.
 * BSON Long values are preserved (use toLong() for conversion to bigint).
 */
export function deserialize(buffer: Buffer): Document {
  return BSON.deserialize(buffer, {
    promoteLongs: false, // Keep BSON Long as Long objects
    promoteValues: false,
  });
}

/**
 * Convert BSON Long values in a deserialized document to bigint.
 */
export function toLong(value: unknown): bigint {
  if (value instanceof BsonLong) {
    return value.toBigInt();
  }
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    return BigInt(value);
  }
  return BigInt(0);
}

/**
 * Recursively convert bigint values to BSON Long for serialization.
 */
function convertBigIntsToLong(obj: unknown): unknown {
  if (typeof obj === 'bigint') {
    return BsonLong.fromBigInt(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(convertBigIntsToLong);
  }
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Buffer)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = convertBigIntsToLong(value);
    }
    return result;
  }
  return obj;
}
