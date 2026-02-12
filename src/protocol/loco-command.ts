/**
 * LOCO protocol command names.
 * Derived from decompilation of lq.EnumC34521d (LocoMethod.kt).
 *
 * Each command has:
 *   - name: the string sent in the 11-byte command field
 *   - isPush: whether this is a server-initiated push (no matching request)
 */

export enum LocoCommand {
  // ── Session ────────────────────────────
  GETCONF     = 'GETCONF',
  CHECKIN     = 'CHECKIN',
  BUYCS       = 'BUYCS',
  LOGINLIST   = 'LOGINLIST',
  PING        = 'PING',

  // ── Messaging ──────────────────────────
  WRITE       = 'WRITE',
  FORWARD     = 'FORWARD',
  MSG         = 'MSG',
  COMPLETE    = 'COMPLETE',
  SYNCMSG     = 'SYNCMSG',
  SYNCNEWMSG  = 'SYNCNEWMSG',
  SYNCMODMSG  = 'SYNCMODMSG',
  SYNCDLMSG   = 'SYNCDLMSG',
  DECUNREAD   = 'DECUNREAD',

  // ── Chat Room ──────────────────────────
  CHATONROOM  = 'CHATONROOM',
  CHATINFO    = 'CHATINFO',
  LCHATLIST   = 'LCHATLIST',
  SETST       = 'SETST',
  SETMETA     = 'SETMETA',
  CHGMETA     = 'CHGMETA',
  CHGCHATST   = 'CHGCHATST',
  CHGMCMETA   = 'CHGMCMETA',
  CHGLOGMETA  = 'CHGLOGMETA',
  CHGMOMETAS  = 'CHGMOMETAS',
  SYNCCREATE  = 'SYNCCREATE',
  SYNCJOIN    = 'SYNCJOIN',

  // ── Members ────────────────────────────
  MEMBER      = 'MEMBER',
  GETMEM      = 'GETMEM',
  ADDMEM      = 'ADDMEM',
  DELMEM      = 'DELMEM',
  NEWMEM      = 'NEWMEM',
  LEFT        = 'LEFT',
  KICKED      = 'KICKED',
  KICKOUT     = 'KICKOUT',
  SYNCMEMT    = 'SYNCMEMT',

  // ── Block/Friend ───────────────────────
  BLOCK       = 'BLOCK',
  BLSYNC      = 'BLSYNC',
  SYNCBLIND   = 'SYNCBLIND',
  SYNCSAFEBT  = 'SYNCSAFEBT',

  // ── Media Upload ───────────────────────
  MSHIP       = 'MSHIP',
  GETTRAILER  = 'GETTRAILER',
  MCHATLOGS   = 'MCHATLOGS',

  // ── OpenLink ───────────────────────────
  CREATELINK  = 'CREATELINK',
  JOINLINK    = 'JOINLINK',
  INFOLINK    = 'INFOLINK',
  UPDATELINK  = 'UPDATELINK',
  DELETELINK  = 'DELETELINK',
  GETOLPROF   = 'GETOLPROF',
  REWRITE     = 'REWRITE',
  SYNCREWR    = 'SYNCREWR',
  LNKDELETED  = 'LNKDELETED',
  LNKUPDATED  = 'LNKUPDATED',
  SYNCLINKCR  = 'SYNCLINKCR',
  SYNCLINKUP  = 'SYNCLINKUP',
  SYNCLINKDL  = 'SYNCLINKDL',
  SYNCLINKPF  = 'SYNCLINKPF',

  // ── Voice/Call ─────────────────────────
  VOEVENT     = 'VOEVENT',
  INVOICE     = 'INVOICE',
  MINVOICE    = 'MINVOICE',

  // ── Feed ───────────────────────────────
  FEED        = 'FEED',

  // ── Server Control ─────────────────────
  CHANGESVR   = 'CHANGESVR',
  RESTART     = 'RESTART',
  KICKOUT_SVR = 'KICKOUT',

  // ── Actions ────────────────────────────
  SYNCACTION  = 'SYNCACTION',
  SYNCEVENT   = 'SYNCEVENT',

  // ── Push/Notification ──────────────────
  SPUSH       = 'SPUSH',
}

/**
 * Set of server-push commands.
 * These are unsolicited messages from the server (no matching request packetId).
 * Derived from lq.EnumC34521d with isPush=true.
 */
export const PUSH_COMMANDS = new Set<string>([
  LocoCommand.MSG,
  LocoCommand.COMPLETE,
  LocoCommand.LEFT,
  LocoCommand.SYNCBLIND,
  LocoCommand.CHGMETA,
  LocoCommand.CHGCHATST,
  LocoCommand.CHANGESVR,
  LocoCommand.VOEVENT,
  LocoCommand.CHGMOMETAS,
  LocoCommand.BLSYNC,
  LocoCommand.SYNCACTION,
  LocoCommand.DECUNREAD,
  LocoCommand.SYNCCREATE,
  LocoCommand.INVOICE,
  LocoCommand.MINVOICE,
  LocoCommand.SYNCEVENT,
  LocoCommand.FEED,
  LocoCommand.DELMEM,
  LocoCommand.SYNCMODMSG,
  LocoCommand.RESTART,
  LocoCommand.NEWMEM,
  LocoCommand.SYNCDLMSG,
  LocoCommand.SYNCMEMT,
  LocoCommand.SYNCSAFEBT,
  LocoCommand.SYNCREWR,
  LocoCommand.KICKED,
  LocoCommand.KICKOUT,
  LocoCommand.CHGMCMETA,
  LocoCommand.CHGLOGMETA,
  LocoCommand.SYNCJOIN,
  LocoCommand.LNKDELETED,
  LocoCommand.SYNCLINKCR,
  LocoCommand.SYNCLINKUP,
  LocoCommand.SYNCLINKDL,
  LocoCommand.LNKUPDATED,
  LocoCommand.SYNCLINKPF,
  LocoCommand.SPUSH,
]);

/**
 * Check if a command is a server push (unsolicited).
 */
export function isPushCommand(command: string): boolean {
  return PUSH_COMMANDS.has(command);
}
