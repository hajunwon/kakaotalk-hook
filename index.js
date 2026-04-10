import inquirer from 'inquirer';
import { loadConfig, TARGET_PKG } from './config.js';
import { runSetup, editConfig } from './setup.js';
import { listDevices, selectDevice, shell } from './adb/device-manager.js';
import { deployAndStart, stopServer } from './adb/frida-server.js';
import { spawnAndHook, attachAndHook } from './frida/script-manager.js';
import { promptAndInstall } from './adb/xapk-installer.js';

const BANNER = `
  ╔══════════════════════════════════════╗
  ║       KakaoTalk Hook Tool            ║
  ║       com.kakao.talk                 ║
  ╚══════════════════════════════════════╝
`;

async function showDevices() {
  const devices = await listDevices();
  if (devices.length === 0) {
    console.log('\n  연결된 디바이스 없음\n');
    return;
  }
  console.log('\n  연결된 디바이스:');
  for (const d of devices) {
    console.log(`    ${d.serial}  [${d.status}]`);
  }
  console.log();
}

async function installFridaServer() {
  const serial = await selectDevice();
  await deployAndStart(serial);
}

async function isAppRunning(serial) {
  try {
    const out = await shell(serial, `pidof ${TARGET_PKG}`);
    if (out) return out.split(/\s+/).filter(Boolean);
  } catch (_) {}
  return [];
}

async function forceStopApp(serial) {
  try {
    await shell(serial, `am force-stop ${TARGET_PKG}`);
  } catch (_) {}
  // 종료 확인 (최대 3초 대기)
  for (let i = 0; i < 6; i++) {
    const pids = await isAppRunning(serial);
    if (pids.length === 0) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function runHookSession(ctx) {
  const cleanup = async () => {
    console.log('\n  정리 중...');
    try { await ctx.script.unload(); } catch {}
    try { await ctx.session.detach(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  await new Promise(() => {});
}

async function hookMenu() {
  const serial = await selectDevice();

  const { mode } = await inquirer.prompt([{
    type: 'list',
    name: 'mode',
    message: 'Hook 방식을 선택하세요:',
    choices: [
      { name: 'Spawn  — 앱을 새로 실행하며 후킹 (권장)', value: 'spawn' },
      { name: 'Attach — 실행 중인 앱에 붙기', value: 'attach' },
      new inquirer.Separator(),
      { name: '← 뒤로', value: 'back' },
    ],
  }]);

  if (mode === 'back') return;

  if (mode === 'spawn') {
    const pids = await isAppRunning(serial);
    if (pids.length > 0) {
      console.log(`\n  ⚠ ${TARGET_PKG} 실행 중 (PID ${pids.join(', ')}) — 자동 종료합니다.`);
      const stopped = await forceStopApp(serial);
      if (!stopped) {
        throw new Error(`${TARGET_PKG} 종료에 실패했습니다. 수동으로 앱을 종료한 뒤 다시 시도하세요.`);
      }
      console.log(`  ✓ 종료 완료`);
    }
    const ctx = await spawnAndHook(serial);
    await runHookSession(ctx);
  } else {
    const pids = await isAppRunning(serial);
    if (pids.length === 0) {
      throw new Error(`${TARGET_PKG}가 실행 중이 아닙니다. Spawn 모드를 사용하거나 먼저 앱을 실행하세요.`);
    }
    const ctx = await attachAndHook(serial);
    await runHookSession(ctx);
  }
}

async function installApk() {
  const serial = await selectDevice();
  await promptAndInstall(serial);
}

async function stopFrida() {
  const serial = await selectDevice();
  await stopServer(serial);
}

async function main() {
  console.log(BANNER);

  // config.json이 없으면 setup 실행
  if (!loadConfig()) {
    console.log('  config.json이 없습니다. 초기 설정을 시작합니다.\n');
    await runSetup();
  }

  while (true) {
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: '작업을 선택하세요:',
      pageSize: 20,
      choices: [
        { name: '1. 디바이스 목록 보기', value: 'devices' },
        { name: '2. APK/XAPK/Split APK 설치', value: 'apk' },
        { name: '3. frida-server 설치 및 실행', value: 'install' },
        { name: '4. Hook (Spawn / Attach)', value: 'hook' },
        { name: '5. frida-server 중지', value: 'stop' },
        new inquirer.Separator(),
        { name: '6. 설정 변경', value: 'setup' },
        { name: '7. 종료', value: 'exit' },
      ],
    }]);

    try {
      switch (action) {
        case 'devices': await showDevices(); break;
        case 'apk': await installApk(); break;
        case 'install': await installFridaServer(); break;
        case 'hook': await hookMenu(); break;
        case 'stop': await stopFrida(); break;
        case 'setup': await editConfig(); break;
        case 'exit': process.exit(0);
      }
    } catch (err) {
      console.error(`\n  오류: ${err.message}\n`);
    }
  }
}

main().catch(err => {
  console.error(`치명적 오류: ${err.message}`);
  process.exit(1);
});
