import inquirer from 'inquirer';
import { loadConfig } from './config.js';
import { runSetup } from './setup.js';
import { listDevices, selectDevice } from './adb/device-manager.js';
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

async function hookSpawn() {
  const serial = await selectDevice();
  const ctx = await spawnAndHook(serial);

  // Ctrl+C 시 정리
  const cleanup = async () => {
    console.log('\n  정리 중...');
    try { await ctx.script.unload(); } catch {}
    try { await ctx.session.detach(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // 무한 대기
  await new Promise(() => {});
}

async function hookAttach() {
  const serial = await selectDevice();
  const ctx = await attachAndHook(serial);

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
      choices: [
        { name: '1. 디바이스 목록 보기', value: 'devices' },
        { name: '2. APK/XAPK/Split APK 설치', value: 'apk' },
        { name: '3. frida-server 설치 및 실행', value: 'install' },
        { name: '4. Hook - Spawn (권장)', value: 'spawn' },
        { name: '5. Hook - Attach', value: 'attach' },
        { name: '6. frida-server 중지', value: 'stop' },
        new inquirer.Separator(),
        { name: '7. 설정 변경', value: 'setup' },
        { name: '8. 종료', value: 'exit' },
      ],
    }]);

    try {
      switch (action) {
        case 'devices': await showDevices(); break;
        case 'apk': await installApk(); break;
        case 'install': await installFridaServer(); break;
        case 'spawn': await hookSpawn(); break;
        case 'attach': await hookAttach(); break;
        case 'stop': await stopFrida(); break;
        case 'setup': await runSetup(); break;
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
