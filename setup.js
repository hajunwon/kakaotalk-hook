import inquirer from 'inquirer';
import { existsSync } from 'node:fs';
import { CONFIG_PATH, getDefaults, saveConfig, loadConfig } from './config.js';

const SCRIPT_NAMES = [
  'anti-detect', 'anti-kill', 'nfilter', 'device-spoof',
  'activity', 'sharedpref', 'kakaotalk-app', 'loco-monitor', 'http-monitor',
];

const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'trace'];

const SPOOF_FIELDS = [
  { key: 'model',        label: 'Model' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'brand',        label: 'Brand' },
  { key: 'device',       label: 'Device' },
  { key: 'product',      label: 'Product' },
  { key: 'hardware',     label: 'Hardware' },
  { key: 'board',        label: 'Board' },
  { key: 'fingerprint',  label: 'Fingerprint' },
  { key: 'display',      label: 'Display' },
  { key: 'androidId',    label: 'Android ID (null 허용)' },
  { key: 'carrier',      label: 'Carrier' },
  { key: 'mccMnc',       label: 'MCC/MNC' },
];

function truncate(s, n) {
  if (!s) return s;
  return s.length > n ? s.substring(0, n - 1) + '…' : s;
}

function ensureConfig() {
  return loadConfig() || getDefaults();
}

export async function runSetup() {
  const defaults = loadConfig() || getDefaults();

  console.log('\n  ── KakaoTalk Hook 설정 ──\n');

  // 1. ADB 경로
  const { adbPath } = await inquirer.prompt([{
    type: 'input',
    name: 'adbPath',
    message: 'adb.exe 경로:',
    default: defaults.adbPath || undefined,
    validate: v => {
      if (!v) return 'ADB 경로를 입력하세요.';
      if (!existsSync(v)) return '파일을 찾을 수 없습니다.';
      return true;
    },
  }]);

  // 2. 디바이스 시리얼 (선택)
  const { deviceSerial } = await inquirer.prompt([{
    type: 'input',
    name: 'deviceSerial',
    message: '디바이스 시리얼 (비워두면 매번 선택):',
    default: defaults.deviceSerial || undefined,
  }]);

  // 3. 글로벌 로그 레벨
  const { logLevel } = await inquirer.prompt([{
    type: 'list',
    name: 'logLevel',
    message: '글로벌 로그 레벨:',
    choices: LOG_LEVELS,
    default: defaults.logLevel,
  }]);

  // 4. 스크립트 선택
  const { enabledScripts } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'enabledScripts',
    message: '활성화할 스크립트 선택:',
    choices: SCRIPT_NAMES.map(name => ({
      name,
      checked: defaults.scripts[name]?.enabled !== false,
    })),
  }]);

  const scripts = {};
  for (const name of SCRIPT_NAMES) {
    scripts[name] = {
      enabled: enabledScripts.includes(name),
      logLevel: defaults.scripts[name]?.logLevel || logLevel,
    };
  }

  // 5. 디바이스 스푸핑
  const { useSpoof } = await inquirer.prompt([{
    type: 'confirm',
    name: 'useSpoof',
    message: '디바이스 스푸핑 설정을 커스터마이즈하시겠습니까?',
    default: false,
  }]);

  let deviceSpoof = defaults.deviceSpoof;
  if (useSpoof) {
    const spoofAnswers = await inquirer.prompt([
      { type: 'input', name: 'model',        message: 'Model:',        default: deviceSpoof.model },
      { type: 'input', name: 'manufacturer', message: 'Manufacturer:', default: deviceSpoof.manufacturer },
      { type: 'input', name: 'brand',        message: 'Brand:',        default: deviceSpoof.brand },
      { type: 'input', name: 'device',       message: 'Device:',       default: deviceSpoof.device },
      { type: 'input', name: 'product',      message: 'Product:',      default: deviceSpoof.product },
      { type: 'input', name: 'fingerprint',  message: 'Fingerprint:',  default: deviceSpoof.fingerprint },
      { type: 'input', name: 'carrier',      message: 'Carrier:',      default: deviceSpoof.carrier },
      { type: 'input', name: 'mccMnc',       message: 'MCC/MNC:',      default: deviceSpoof.mccMnc },
    ]);
    deviceSpoof = { ...deviceSpoof, ...spoofAnswers };
  }

  // 저장
  const config = {
    adbPath,
    deviceSerial: deviceSerial || '',
    fridaServerPath: defaults.fridaServerPath || '',
    logLevel,
    scripts,
    deviceSpoof,
  };

  saveConfig(config);
  console.log(`\n  ✓ 설정이 config.json에 저장되었습니다.\n`);
  return config;
}

// ============================================================
// 항목별 편집 메뉴
// ============================================================

async function editAdbPath() {
  const cfg = ensureConfig();
  const { adbPath } = await inquirer.prompt([{
    type: 'input',
    name: 'adbPath',
    message: 'adb.exe 경로:',
    default: cfg.adbPath || undefined,
    validate: v => {
      if (!v) return 'ADB 경로를 입력하세요.';
      if (!existsSync(v)) return '파일을 찾을 수 없습니다.';
      return true;
    },
  }]);
  saveConfig({ ...cfg, adbPath });
  console.log(`  ✓ adbPath 저장됨\n`);
}

async function editDeviceSerial() {
  const cfg = ensureConfig();
  const { deviceSerial } = await inquirer.prompt([{
    type: 'input',
    name: 'deviceSerial',
    message: '디바이스 시리얼 (비워두면 매번 선택):',
    default: cfg.deviceSerial || undefined,
  }]);
  saveConfig({ ...cfg, deviceSerial: deviceSerial || '' });
  console.log(`  ✓ deviceSerial 저장됨\n`);
}

async function editFridaServerPath() {
  const cfg = ensureConfig();
  const { fridaServerPath } = await inquirer.prompt([{
    type: 'input',
    name: 'fridaServerPath',
    message: 'frida-server 경로 (비워두면 자동 다운로드):',
    default: cfg.fridaServerPath || undefined,
    validate: v => {
      if (!v) return true;
      if (!existsSync(v)) return '파일을 찾을 수 없습니다.';
      return true;
    },
  }]);
  saveConfig({ ...cfg, fridaServerPath: fridaServerPath || '' });
  console.log(`  ✓ fridaServerPath 저장됨\n`);
}

async function editGlobalLogLevel() {
  const cfg = ensureConfig();
  const { logLevel } = await inquirer.prompt([{
    type: 'list',
    name: 'logLevel',
    message: '글로벌 로그 레벨:',
    choices: LOG_LEVELS,
    default: cfg.logLevel,
  }]);
  saveConfig({ ...cfg, logLevel });
  console.log(`  ✓ logLevel = ${logLevel}\n`);
}

async function editEnabledScripts() {
  const cfg = ensureConfig();
  const { enabled } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'enabled',
    message: '활성화할 스크립트 선택 (space=토글, enter=확정):',
    choices: SCRIPT_NAMES.map(name => ({
      name: `${name}  \x1b[2m(log=${cfg.scripts[name]?.logLevel || cfg.logLevel})\x1b[0m`,
      value: name,
      checked: cfg.scripts[name]?.enabled !== false,
    })),
  }]);

  const scripts = { ...cfg.scripts };
  for (const name of SCRIPT_NAMES) {
    scripts[name] = {
      enabled: enabled.includes(name),
      logLevel: cfg.scripts[name]?.logLevel || cfg.logLevel,
    };
  }
  saveConfig({ ...cfg, scripts });
  console.log(`  ✓ ${enabled.length}개 스크립트 활성화\n`);
}

async function editScriptLogLevels() {
  while (true) {
    const cfg = ensureConfig();

    const { script } = await inquirer.prompt([{
      type: 'list',
      name: 'script',
      message: '로그 레벨을 바꿀 스크립트:',
      choices: [
        ...SCRIPT_NAMES.map(name => {
          const s = cfg.scripts[name] || {};
          const lvl = s.logLevel || cfg.logLevel;
          const on = s.enabled !== false ? '\x1b[32m●\x1b[0m' : '\x1b[31m○\x1b[0m';
          return { name: `${on} ${name.padEnd(15)}  \x1b[2m${lvl}\x1b[0m`, value: name };
        }),
        new inquirer.Separator(),
        { name: '← 뒤로', value: '__back' },
      ],
    }]);

    if (script === '__back') return;

    const { logLevel } = await inquirer.prompt([{
      type: 'list',
      name: 'logLevel',
      message: `${script} 로그 레벨:`,
      choices: LOG_LEVELS,
      default: cfg.scripts[script]?.logLevel || cfg.logLevel,
    }]);

    const scripts = { ...cfg.scripts };
    scripts[script] = {
      enabled: scripts[script]?.enabled !== false,
      logLevel,
    };
    saveConfig({ ...cfg, scripts });
    console.log(`  ✓ ${script}.logLevel = ${logLevel}\n`);
  }
}

async function editDeviceSpoof() {
  while (true) {
    const cfg = ensureConfig();
    const spoof = cfg.deviceSpoof;

    const { field } = await inquirer.prompt([{
      type: 'list',
      name: 'field',
      message: '수정할 디바이스 스푸핑 항목:',
      choices: [
        ...SPOOF_FIELDS.map(f => {
          const v = spoof[f.key];
          const display = v == null ? '\x1b[2mnull\x1b[0m' : `\x1b[36m${truncate(String(v), 50)}\x1b[0m`;
          return { name: `${f.label.padEnd(24)} ${display}`, value: f.key };
        }),
        new inquirer.Separator(),
        { name: '← 뒤로', value: '__back' },
      ],
      pageSize: 16,
    }]);

    if (field === '__back') return;

    const fieldDef = SPOOF_FIELDS.find(f => f.key === field);
    const { value } = await inquirer.prompt([{
      type: 'input',
      name: 'value',
      message: `${fieldDef.label}:`,
      default: spoof[field] == null ? '' : String(spoof[field]),
    }]);

    const updated = { ...spoof };
    if (field === 'androidId' && (!value || value.toLowerCase() === 'null')) {
      updated[field] = null;
    } else {
      updated[field] = value;
    }
    saveConfig({ ...cfg, deviceSpoof: updated });
    console.log(`  ✓ deviceSpoof.${field} 저장됨\n`);
  }
}

function viewConfig() {
  const cfg = ensureConfig();
  const C = { reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', yel: '\x1b[33m' };

  console.log(`\n  ${C.bold}── 현재 설정 ──${C.reset}\n`);
  console.log(`  ${C.dim}adbPath${C.reset}          ${cfg.adbPath || C.dim + '(미설정)' + C.reset}`);
  console.log(`  ${C.dim}deviceSerial${C.reset}     ${cfg.deviceSerial || C.dim + '(매번 선택)' + C.reset}`);
  console.log(`  ${C.dim}fridaServerPath${C.reset}  ${cfg.fridaServerPath || C.dim + '(자동 다운로드)' + C.reset}`);
  console.log(`  ${C.dim}logLevel${C.reset}         ${C.yel}${cfg.logLevel}${C.reset}`);

  console.log(`\n  ${C.bold}Scripts${C.reset}`);
  for (const name of SCRIPT_NAMES) {
    const s = cfg.scripts[name] || {};
    const on = s.enabled !== false ? `${C.green}●${C.reset}` : `${C.red}○${C.reset}`;
    const lvl = s.logLevel || cfg.logLevel;
    console.log(`    ${on} ${name.padEnd(16)} ${C.dim}log=${C.reset}${C.yel}${lvl}${C.reset}`);
  }

  console.log(`\n  ${C.bold}Device Spoof${C.reset}`);
  for (const f of SPOOF_FIELDS) {
    const v = cfg.deviceSpoof[f.key];
    const display = v == null ? `${C.dim}null${C.reset}` : `${C.cyan}${truncate(String(v), 60)}${C.reset}`;
    console.log(`    ${f.label.padEnd(24)} ${display}`);
  }
  console.log();
}

export async function editConfig() {
  while (true) {
    const cfg = ensureConfig();
    const C = { reset: '\x1b[0m', dim: '\x1b[2m' };
    const enabledCount = SCRIPT_NAMES.filter(n => cfg.scripts[n]?.enabled !== false).length;

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: '설정 변경 — 항목을 선택하세요:',
      pageSize: 14,
      choices: [
        { name: `1. ADB 경로                ${C.dim}${truncate(cfg.adbPath || '(미설정)', 50)}${C.reset}`, value: 'adb' },
        { name: `2. 디바이스 시리얼         ${C.dim}${cfg.deviceSerial || '(매번 선택)'}${C.reset}`, value: 'serial' },
        { name: `3. frida-server 경로       ${C.dim}${truncate(cfg.fridaServerPath || '(자동 다운로드)', 50)}${C.reset}`, value: 'frida' },
        { name: `4. 글로벌 로그 레벨        ${C.dim}${cfg.logLevel}${C.reset}`, value: 'loglevel' },
        { name: `5. 스크립트 활성화         ${C.dim}${enabledCount}/${SCRIPT_NAMES.length} 활성화${C.reset}`, value: 'scripts' },
        { name: `6. 스크립트별 로그 레벨`, value: 'scriptlevel' },
        { name: `7. 디바이스 스푸핑`, value: 'spoof' },
        new inquirer.Separator(),
        { name: `8. 현재 설정 보기`, value: 'view' },
        { name: `9. 전체 재설정 (wizard)`, value: 'wizard' },
        { name: `0. 뒤로`, value: 'back' },
      ],
    }]);

    try {
      switch (action) {
        case 'adb':         await editAdbPath();          break;
        case 'serial':      await editDeviceSerial();     break;
        case 'frida':       await editFridaServerPath();  break;
        case 'loglevel':    await editGlobalLogLevel();   break;
        case 'scripts':     await editEnabledScripts();   break;
        case 'scriptlevel': await editScriptLogLevels();  break;
        case 'spoof':       await editDeviceSpoof();      break;
        case 'view':        viewConfig();                 break;
        case 'wizard':      await runSetup();             break;
        case 'back':        return;
      }
    } catch (err) {
      console.error(`\n  오류: ${err.message}\n`);
    }
  }
}
