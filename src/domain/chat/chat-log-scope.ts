/**
 * Chat log scope (visibility context).
 * Derived from decompilation of Qp.C16418b (ChatLogScope.kt).
 *
 * Scope is a bitmask that controls where a message is visible:
 *   Bit 0 (value 1): visible in the main chat room
 *   Bit 1 (value 2): visible in thread detail view
 *
 * Determination logic (from ChatMediaSender.kt, ah.C22075c.f()):
 *   - threadId == null || threadId <= 0  →  ONLY_CHAT_ROOM (1)
 *   - threadId > 0 + showInChatRoom flag →  CHAT_ROOM_AND_THREAD_DETAIL (3)
 *   - threadId > 0 + no flag             →  ONLY_THREAD_DETAIL (2)
 */

export enum ChatLogScope {
  /** Message visible only in the main chat room (no thread) */
  ONLY_CHAT_ROOM = 1,
  /** Message visible only in the thread detail view */
  ONLY_THREAD_DETAIL = 2,
  /** Message visible in both chat room and thread detail */
  CHAT_ROOM_AND_THREAD_DETAIL = 3,
}

/** Check if a scope value indicates visibility in the main chat room */
export function isVisibleInChatRoom(scope: number): boolean {
  return (scope & 1) !== 0;
}

/** Check if a scope value indicates visibility in thread detail */
export function isVisibleInThreadDetail(scope: number): boolean {
  return (scope & 2) !== 0;
}

/**
 * Determine the correct scope based on threadId and visibility preference.
 *
 * @param threadId - The thread ID (null/0 means no thread)
 * @param showInChatRoom - Whether threaded reply should also show in chat room
 */
export function determineScope(
  threadId: bigint | null | undefined,
  showInChatRoom = true,
): ChatLogScope {
  if (threadId == null || threadId <= 0n) {
    return ChatLogScope.ONLY_CHAT_ROOM;
  }
  return showInChatRoom
    ? ChatLogScope.CHAT_ROOM_AND_THREAD_DETAIL
    : ChatLogScope.ONLY_THREAD_DETAIL;
}
