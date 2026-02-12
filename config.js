import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 경로 상수 ──────────────────────────────────────────────
export const PROJECT_ROOT = __dirname;
export const CACHE_DIR = resolve(__dirname, '.cache');
export const CONFIG_PATH = resolve(__dirname, 'config.json');
export const TARGET_PKG = 'com.kakao.talk';
export const FRIDA_SERVER_REMOTE = '/data/local/tmp/frida-server';

// ── 기본값 ─────────────────────────────────────────────────
const DEFAULTS = {
  adbPath: '',
  deviceSerial: '',
  fridaServerPath: '',
  logLevel: 'info',
  scripts: {
    'anti-detect':   { enabled: true,  logLevel: 'info' },
    'anti-kill':     { enabled: true,  logLevel: 'info' },
    'nfilter':       { enabled: true,  logLevel: 'info' },
    'device-spoof':  { enabled: true,  logLevel: 'info' },
    'activity':      { enabled: true,  logLevel: 'info' },
    'sharedpref':    { enabled: true,  logLevel: 'info' },
    'kakaotalk-app': { enabled: true,  logLevel: 'info' },
    'loco-monitor':  { enabled: true,  logLevel: 'info' },
    'http-monitor':  { enabled: true,  logLevel: 'debug' },
  },
  deviceSpoof: {
    model:        'SM-S928N',
    manufacturer: 'samsung',
    brand:        'samsung',
    device:       'e3q',
    product:      'e3qks',
    hardware:     'qcom',
    board:        'sun',
    fingerprint:  'samsung/e3qks/e3q:14/UP1A.231005.007/S928NKSS3AXL2:user/release-keys',
    display:      'UP1A.231005.007.S928NKSS3AXL2',
    androidId:    null,
    carrier:      'SKTelecom',
    mccMnc:       '45005',
  },
};

// ── config.json 로딩 ───────────────────────────────────────
let _config = null;

export function loadConfig() {
  if (_config) return _config;

  if (!existsSync(CONFIG_PATH)) {
    return null; // setup 필요
  }

  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  _config = deepMerge(structuredClone(DEFAULTS), raw);
  return _config;
}

export function getConfig() {
  if (!_config) throw new Error('config.json이 로드되지 않았습니다.');
  return _config;
}

export function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  _config = config;
}

export function getDefaults() {
  return structuredClone(DEFAULTS);
}

// ── ADB 경로 ───────────────────────────────────────────────
export function getAdbPath() {
  const cfg = getConfig();
  if (!cfg.adbPath) {
    throw new Error('adbPath가 설정되지 않았습니다. config.json을 확인하세요.');
  }
  return cfg.adbPath;
}

// ── export: Frida에 주입할 형태로 변환 ─────────────────────
export function getFridaHooks() {
  const cfg = getConfig();
  return {
    globalLogLevel: cfg.logLevel,
    scripts: cfg.scripts,
  };
}

export function getDeviceSpoof() {
  const cfg = getConfig();
  const s = cfg.deviceSpoof;
  return {
    MODEL:        s.model,
    MANUFACTURER: s.manufacturer,
    BRAND:        s.brand,
    DEVICE:       s.device,
    PRODUCT:      s.product,
    HARDWARE:     s.hardware,
    BOARD:        s.board,
    FINGERPRINT:  s.fingerprint,
    DISPLAY:      s.display,
    ANDROID_ID:   s.androidId || null,
    CARRIER:      s.carrier,
    MCC_MNC:      s.mccMnc,
  };
}

// ── 유틸 ───────────────────────────────────────────────────
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
    ) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
