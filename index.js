import inquirer from 'inquirer';
import { loadConfig, TARGET_PKG } from './config.js';
import { runSetup, editConfig } from './setup.js';
import { listDevices, selectDevice, shell } from './adb/device-manager.js';
import { deployAndStart, stopServer } from './adb/frida-server.js';
import { spawnAndHook, attachAndHook } from './frida/script-manager.js';
import { promptAndInstall } from './adb/xapk-installer.js';
import { promptAndExtract } from './adb/apk-extractor.js';
import { scanPorts, identifyConnections, adbDisconnect } from './adb/device-scanner.js';

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

async function extractApk() {
  const serial = await selectDevice();
  await promptAndExtract(serial);
}

async function scanDevices() {
  console.log('');
  const results = await scanPorts({
    onProgress: msg => console.log(`  ${msg}`),
  });

  const connected = results.filter(r => r.connected);
  const openButFailed = results.filter(r => r.open && !r.connected && r.port !== 5037);

  console.log('');
  if (connected.length === 0) {
    console.log('  연결에 성공한 포트 없음.');
  } else {
    console.log(`  ✓ 연결 성공 ${connected.length}개. 디바이스 식별 중...`);
    const groups = await identifyConnections(results);

    console.log(`\n  고유 디바이스 ${groups.length}개:`);
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const id = g[0].identity;
      const label = [id.manufacturer, id.model].filter(Boolean).join(' ') || '(unknown)';
      const keyHint = id.serialno || id.mac || id.key;
      console.log(`\n    #${i + 1} ${label}  (id: ${keyHint})`);
      for (const e of g) {
        const marker = e === g[0] ? '→' : ' ';
        console.log(`      ${marker} 127.0.0.1:${e.port}  — ${e.label}`);
      }
      if (g.length > 1) {
        console.log(`      ↑ ${g.length - 1}개가 동일 디바이스로의 중복 연결`);
      }
    }

    const duplicates = groups.flatMap(g => g.slice(1));
    if (duplicates.length > 0) {
      const { cleanup } = await inquirer.prompt([{
        type: 'confirm',
        name: 'cleanup',
        message: `중복 연결 ${duplicates.length}개를 disconnect 하시겠습니까?`,
        default: true,
      }]);
      if (cleanup) {
        for (const d of duplicates) {
          const ok = await adbDisconnect(d.endpoint);
          console.log(`    ${ok ? '✓' : '✗'} disconnect ${d.endpoint}`);
        }
      }
    }
  }

  if (openButFailed.length > 0) {
    console.log(`\n  ⚠ 포트는 열려있으나 adb connect 실패 ${openButFailed.length}개:`);
    for (const r of openButFailed) {
      console.log(`    127.0.0.1:${r.port}  — ${r.label}${r.message ? '  (' + r.message + ')' : ''}`);
    }
  }

  const devices = await listDevices();
  console.log(`\n  현재 adb devices (${devices.length}개):`);
  for (const d of devices) {
    console.log(`    ${d.serial}  [${d.status}]`);
  }
  console.log();
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
        { name: '2. 디바이스 자동 스캔 (에뮬레이터/TCP ADB 포트)', value: 'scan' },
        { name: '3. APK/XAPK/Split APK 설치', value: 'apk' },
        { name: '4. APK/Split APK 추출 (Device → Local)', value: 'extract' },
        { name: '5. frida-server 설치 및 실행', value: 'install' },
        { name: '6. Hook (Spawn / Attach)', value: 'hook' },
        { name: '7. frida-server 중지', value: 'stop' },
        new inquirer.Separator(),
        { name: '8. 설정 변경', value: 'setup' },
        { name: '9. 종료', value: 'exit' },
      ],
    }]);

    try {
      switch (action) {
        case 'devices': await showDevices(); break;
        case 'scan': await scanDevices(); break;
        case 'apk': await installApk(); break;
        case 'extract': await extractApk(); break;
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
