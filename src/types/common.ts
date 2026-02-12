/**
 * Common type definitions shared across the KakaoTalk client library.
 */

/** Java Long compatible bigint type alias */
export type Long = bigint;

/** Unix epoch timestamp in seconds */
export type Timestamp = number;

/** Unix epoch timestamp in milliseconds */
export type TimestampMs = number;

/** LOCO packet ID (uint32, auto-incrementing per session) */
export type PacketId = number;

/** BSON document type (generic key-value) */
export type BsonDocument = Record<string, unknown>;
