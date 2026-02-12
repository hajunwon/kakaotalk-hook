import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, mkdirSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createUnzip } from 'node:zlib';
import { getAdbPath, CACHE_DIR } from '../config.js';
import inquirer from 'inquirer';

const execFileAsync = promisify(execFile);

// ZIP 해제: .NET System.IO.Compression 사용 (확장자 제한 없음)
async function extractZip(zipPath, destDir) {
  if (existsSync(destDir)) rmSync(destDir, { recursive: true });
  mkdirSync(destDir, { recursive: true });

  // .NET ZipFile.ExtractToDirectory는 확장자 상관없이 ZIP 포맷이면 해제 가능
  await execFileAsync('powershell', [
    '-NoProfile', '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${zipPath}', '${destDir}')`,
  ], { timeout: 120000 });
}

function findApkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isFile() && extname(entry).toLowerCase() === '.apk') {
      files.push(full);
    }
    // xapk는 보통 flat 구조이지만 혹시 하위 디렉토리가 있을 수 있음
    if (stat.isDirectory()) {
      files.push(...findApkFiles(full));
    }
  }
  return files;
}

export async function installXapk(serial, xapkPath) {
  const adb = getAdbPath();
  const extractDir = resolve(CACHE_DIR, 'xapk-extract');

  console.log(`\n  xapk 압축 해제 중: ${xapkPath}`);
  await extractZip(xapkPath, extractDir);

  const apkFiles = findApkFiles(extractDir);
  if (apkFiles.length === 0) {
    throw new Error('xapk 안에 APK 파일을 찾을 수 없습니다.');
  }

  console.log(`  APK 파일 ${apkFiles.length}개 발견:`);
  for (const f of apkFiles) {
    const size = (statSync(f).size / (1024 * 1024)).toFixed(1);
    console.log(`    - ${f.split(/[\\/]/).pop()} (${size} MB)`);
  }

  // 전체 APK 크기 합산 (install-multiple -S 옵션용)
  const totalSize = apkFiles.reduce((sum, f) => sum + statSync(f).size, 0);

  if (apkFiles.length === 1) {
    // 단일 APK
    console.log(`\n  단일 APK 설치 중...`);
    const { stdout } = await execFileAsync(adb, [
      '-s', serial, 'install', '-r', apkFiles[0],
    ], { timeout: 300000 });
    console.log(`  ${stdout.trim()}`);
  } else {
    // Split APK → adb install-multiple
    console.log(`\n  Split APK 설치 중 (install-multiple)...`);
    const args = ['-s', serial, 'install-multiple', '-r', ...apkFiles];
    const { stdout } = await execFileAsync(adb, args, { timeout: 300000 });
    console.log(`  ${stdout.trim()}`);
  }

  // 정리
  rmSync(extractDir, { recursive: true, force: true });
  console.log(`  설치 완료!\n`);
}

export async function promptAndInstall(serial) {
  const { xapkPath } = await inquirer.prompt([{
    type: 'input',
    name: 'xapkPath',
    message: 'xapk 파일 경로를 입력하세요:',
    validate: (v) => {
      if (!existsSync(v)) return '파일을 찾을 수 없습니다.';
      const ext = extname(v).toLowerCase();
      if (ext !== '.xapk' && ext !== '.apk' && ext !== '.apks') {
        return '.xapk, .apk, .apks 파일만 지원합니다.';
      }
      return true;
    },
  }]);

  const ext = extname(xapkPath).toLowerCase();

  if (ext === '.apk') {
    // 일반 APK 직접 설치
    console.log(`\n  APK 설치 중...`);
    const { stdout } = await execFileAsync(getAdbPath(), [
      '-s', serial, 'install', '-r', xapkPath,
    ], { timeout: 300000 });
    console.log(`  ${stdout.trim()}\n`);
  } else {
    // xapk / apks → ZIP 해제 후 split install
    await installXapk(serial, xapkPath);
  }
}
