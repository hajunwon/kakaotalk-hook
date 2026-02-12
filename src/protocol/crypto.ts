/**
 * Cryptographic utilities for KakaoTalk protocol.
 * Extracted from auth.ts for reuse across the library.
 */
import crypto from 'crypto';

// ── Constants ──────────────────────────────────────
const SALT = 'dkljleskljfeisflssljeif';
const PASSWORD_KEY = 'jEibeliJAhlEeyoOnjuNg';

// ── Device ID Generation ───────────────────────────

/** Generate a SHA256-based device UUID with salt and timestamp */
export function createDeviceUUID(): string {
  const raw = `${crypto.randomUUID()}-${Date.now()}`;
  return crypto.createHash('sha256').update(`${SALT} ${raw}`).digest('hex');
}

/** SHA1 hash of Android ID (used as SSAID) */
export function hashAndroidId(androidId: string): string {
  return crypto.createHash('sha1').update(`${SALT} ${androidId}`).digest('hex');
}

// ── Password Encryption ────────────────────────────

/** AES-256-CBC password encryption for sub-device login */
export function encryptPassword(password: string): string {
  const keyBytes = Buffer.alloc(32);
  const raw = Buffer.from(PASSWORD_KEY, 'utf8');
  raw.copy(keyBytes, 0, 0, Math.min(raw.length, 32));
  const iv = Buffer.from(PASSWORD_KEY.substring(0, 16), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-cbc', keyBytes, iv);
  return Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]).toString('base64');
}

// ── XVC Header ─────────────────────────────────────

/**
 * Generate X-VC header value.
 * Formula: SHA512("BARD|{userAgent}|DANTE|{key}|SIAN").substring(0, 16)
 */
export function generateXVCKey(userAgent: string, key: string): string {
  return crypto
    .createHash('sha512')
    .update(`BARD|${userAgent}|DANTE|${key}|SIAN`)
    .digest('hex')
    .substring(0, 16);
}

// ── Device Config ──────────────────────────────────

export interface DeviceConfig {
  /** SHA256 device UUID */
  duuid: string;
  /** Advertising ID (random UUID) */
  adid: string;
  /** SHA1 of Android ID */
  ssaid: string;
  /** Device model name */
  model: string;
  /** User-Agent string */
  userAgent: string;
  /** App version */
  appVersion: string;
  /** OS version */
  osVersion: string;
  /** Language code */
  language: string;
}

export interface DeviceConfigOptions {
  androidId?: string;
  model?: string;
  appVersion?: string;
  osVersion?: string;
  language?: string;
}

const DEFAULTS = {
  appVersion: '26.1.3',
  osVersion: '14',
  language: 'ko',
  model: 'Pixel 7',
} as const;

export function buildUserAgent(appVersion: string, osVersion: string, language: string): string {
  return `KT/${appVersion} An/${osVersion} ${language}`;
}

export function buildDeviceInfoHeader(duuid: string, ssaid: string, model: string, osVersion: string): string {
  return `android/${osVersion}; uuid=${duuid}; ssaid=${ssaid}; model=${model}; screen_resolution=1080x2340; sim=/0/0; e=; uvc3=`;
}

export function createDeviceConfig(options: DeviceConfigOptions = {}): DeviceConfig {
  const appVersion = options.appVersion ?? DEFAULTS.appVersion;
  const osVersion = options.osVersion ?? DEFAULTS.osVersion;
  const language = options.language ?? DEFAULTS.language;
  const model = options.model ?? DEFAULTS.model;

  const duuid = createDeviceUUID();
  const adid = crypto.randomUUID();
  const ssaid = hashAndroidId(options.androidId ?? crypto.randomBytes(8).toString('hex'));

  return {
    duuid,
    adid,
    ssaid,
    model,
    userAgent: buildUserAgent(appVersion, osVersion, language),
    appVersion,
    osVersion,
    language,
  };
}
