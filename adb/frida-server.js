import { createWriteStream, existsSync, mkdirSync, readFileSync, createReadStream } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { shell, push, getArch } from './device-manager.js';
import { CACHE_DIR, FRIDA_SERVER_REMOTE } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getFridaVersion() {
  const pkgPath = resolve(__dirname, '..', 'node_modules', 'frida', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

function getServerFilename(arch, version) {
  return `frida-server-${version}-android-${arch}`;
}

function getDownloadUrl(arch, version) {
  const filename = getServerFilename(arch, version);
  return `https://github.com/frida/frida/releases/download/${version}/${filename}.xz`;
}

async function downloadFile(url, destPath) {
  console.log(`  다운로드 중: ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`다운로드 실패: ${res.status} ${res.statusText}`);
  await pipeline(res.body, createWriteStream(destPath));
  console.log(`  저장 완료: ${destPath}`);
}

async function extractXz(xzPath, outPath) {
  console.log(`  xz 해제 중...`);
  const lzma = await import('lzma-native');
  const decompressor = lzma.createDecompressor();
  await pipeline(
    createReadStream(xzPath),
    decompressor,
    createWriteStream(outPath),
  );
  console.log(`  해제 완료: ${outPath}`);
}

export async function ensureFridaServer(serial) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

  const version = getFridaVersion();
  const arch = await getArch(serial);
  const filename = getServerFilename(arch, version);
  const binaryPath = resolve(CACHE_DIR, filename);
  const xzPath = binaryPath + '.xz';

  console.log(`\n  frida 버전: ${version}`);
  console.log(`  디바이스 arch: ${arch}`);

  if (!existsSync(binaryPath)) {
    if (!existsSync(xzPath)) {
      await downloadFile(getDownloadUrl(arch, version), xzPath);
    }
    await extractXz(xzPath, binaryPath);
  } else {
    console.log(`  캐시된 바이너리 사용: ${binaryPath}`);
  }

  return binaryPath;
}

export async function deployAndStart(serial) {
  const binaryPath = await ensureFridaServer(serial);

  // 기존 frida-server 중지
  try {
    await shell(serial, 'su -c "killall frida-server"');
    console.log('  기존 frida-server 종료됨');
  } catch { /* 실행 중이 아닐 수 있음 */ }

  // push
  console.log(`  frida-server push 중...`);
  await push(serial, binaryPath, FRIDA_SERVER_REMOTE);
  await shell(serial, `su -c "chmod 755 ${FRIDA_SERVER_REMOTE}"`);

  // start (백그라운드)
  console.log(`  frida-server 시작 중...`);
  // su -c 로 백그라운드 실행. shell이 hang되지 않도록 nohup + &
  shell(serial, `su -c "nohup ${FRIDA_SERVER_REMOTE} -D >/dev/null 2>&1 &"`).catch(() => {});

  // 잠시 대기 후 확인
  await new Promise(r => setTimeout(r, 1500));
  const ps = await shell(serial, 'su -c "ps -A | grep frida-server"');
  if (ps.includes('frida-server')) {
    console.log('  frida-server 실행 확인됨!');
    return true;
  } else {
    console.error('  frida-server 실행 실패. 디바이스 root 권한을 확인하세요.');
    return false;
  }
}

export async function stopServer(serial) {
  try {
    await shell(serial, 'su -c "killall frida-server"');
    console.log('  frida-server 종료됨');
  } catch {
    console.log('  frida-server가 실행 중이 아닙니다.');
  }
}
