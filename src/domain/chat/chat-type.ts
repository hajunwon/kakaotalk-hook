/**
 * Chat message type enum.
 * Derived from decompilation of Qp.c (ChatType.kt).
 *
 * Each type corresponds to a specific message format.
 * The attachment JSON structure varies by type.
 */
export enum ChatType {
  /** Plain text message */
  Text = 1,
  /** Photo/image message */
  Photo = 2,
  /** Video message */
  Video = 3,
  /** Voice/audio message */
  Audio = 5,
  /** Location/map message */
  Map = 6,
  /** Calendar event */
  Schedule = 7,
  /** Contact (phone number/profile) */
  Contact = 12,
  /** File/document attachment */
  File = 14,
  /** System message (e.g., "User joined") */
  Feed = 15,
  /** Sticker (emoticon) */
  Sticker = 16,
  /** Multiple photos in one message */
  MultiPhoto = 17,
  /** Call action message */
  Call = 18,
  /** Music share */
  Music = 20,
  /** KakaoTV video link */
  KakaoTV = 22,
  /** Sharp search (#search) message */
  SharpSearch = 24,
  /** Content from KakaoMini (mini app) */
  KakaoMini = 26,
  /** Post/story share */
  Post = 27,
  /** Rich text message with formatting */
  Reply = 71,
  /** MMS message (carrier SMS/MMS) */
  MMS = 100,
}

/**
 * Check if a chat type represents media content.
 */
export function isMediaType(type: number): boolean {
  return (
    type === ChatType.Photo ||
    type === ChatType.Video ||
    type === ChatType.Audio ||
    type === ChatType.File ||
    type === ChatType.MultiPhoto
  );
}

/**
 * Get a human-readable name for a chat type.
 */
export function chatTypeName(type: number): string {
  const entry = Object.entries(ChatType).find(([, v]) => v === type);
  return entry ? entry[0] : `Unknown(${type})`;
}
