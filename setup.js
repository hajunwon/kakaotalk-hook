import inquirer from 'inquirer';
import { existsSync } from 'node:fs';
import { CONFIG_PATH, getDefaults, saveConfig, loadConfig } from './config.js';

const SCRIPT_NAMES = [
  'anti-detect', 'anti-kill', 'nfilter', 'device-spoof',
  'activity', 'sharedpref', 'kakaotalk-app', 'loco-monitor', 'http-monitor',
];

const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'trace'];

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
