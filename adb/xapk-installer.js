import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { resolve, extname, basename } from 'node:path';
import { getAdbPath, CACHE_DIR } from '../config.js';
import inquirer from 'inquirer';

const execFileAsync = promisify(execFile);

// ZIP 해제: .NET System.IO.Compression 사용 (확장자 제한 없음)
async function extractZip(zipPath, destDir) {
  if (existsSync(destDir)) rmSync(destDir, { recursive: true });
  mkdirSync(destDir, { recursive: true });

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
    if (stat.isDirectory()) {
      files.push(...findApkFiles(full));
    }
  }
  return files;
}

// base.apk를 맨 앞으로 정렬 (adb install-multiple이 요구하지는 않지만 관례)
function sortApkFiles(files) {
  return [...files].sort((a, b) => {
    const aBase = basename(a).toLowerCase() === 'base.apk' ? 0 : 1;
    const bBase = basename(b).toLowerCase() === 'base.apk' ? 0 : 1;
    if (aBase !== bBase) return aBase - bBase;
    return basename(a).localeCompare(basename(b));
  });
}

async function installApkFiles(serial, apkFiles) {
  const adb = getAdbPath();
  const sorted = sortApkFiles(apkFiles);

  console.log(`  APK 파일 ${sorted.length}개:`);
  for (const f of sorted) {
    const size = (statSync(f).size / (1024 * 1024)).toFixed(1);
    console.log(`    - ${basename(f)} (${size} MB)`);
  }

  if (sorted.length === 1) {
    console.log(`\n  단일 APK 설치 중...`);
    const { stdout } = await execFileAsync(adb, [
      '-s', serial, 'install', '-r', sorted[0],
    ], { timeout: 300000 });
    console.log(`  ${stdout.trim()}`);
  } else {
    console.log(`\n  Split APK 설치 중 (install-multiple)...`);
    const { stdout } = await execFileAsync(adb, [
      '-s', serial, 'install-multiple', '-r', ...sorted,
    ], { timeout: 300000 });
    console.log(`  ${stdout.trim()}`);
  }
}

export async function installXapk(serial, xapkPath) {
  const extractDir = resolve(CACHE_DIR, 'xapk-extract');

  console.log(`\n  xapk 압축 해제 중: ${xapkPath}`);
  await extractZip(xapkPath, extractDir);

  const apkFiles = findApkFiles(extractDir);
  if (apkFiles.length === 0) {
    throw new Error('xapk 안에 APK 파일을 찾을 수 없습니다.');
  }

  try {
    await installApkFiles(serial, apkFiles);
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
  console.log(`  설치 완료!\n`);
}

export async function installSplitDir(serial, dirPath) {
  console.log(`\n  디렉토리에서 split APK 검색 중: ${dirPath}`);
  const apkFiles = findApkFiles(dirPath);
  if (apkFiles.length === 0) {
    throw new Error('디렉토리 안에 APK 파일이 없습니다.');
  }
  await installApkFiles(serial, apkFiles);
  console.log(`  설치 완료!\n`);
}

export async function installApkFile(serial, apkPath) {
  await installApkFiles(serial, [apkPath]);
  console.log(`  설치 완료!\n`);
}

export async function promptAndInstall(serial) {
  const { targetPath } = await inquirer.prompt([{
    type: 'input',
    name: 'targetPath',
    message: 'APK 경로 입력 (.apk/.xapk/.apks 파일 또는 split APK 디렉토리):',
    validate: (v) => {
      if (!existsSync(v)) return '경로를 찾을 수 없습니다.';
      const stat = statSync(v);
      if (stat.isDirectory()) {
        const apks = findApkFiles(v);
        if (apks.length === 0) return '디렉토리 안에 .apk 파일이 없습니다.';
        return true;
      }
      const ext = extname(v).toLowerCase();
      if (ext !== '.xapk' && ext !== '.apk' && ext !== '.apks') {
        return '.xapk, .apk, .apks 파일 또는 디렉토리를 지정하세요.';
      }
      return true;
    },
  }]);

  const stat = statSync(targetPath);
  if (stat.isDirectory()) {
    await installSplitDir(serial, targetPath);
    return;
  }

  const ext = extname(targetPath).toLowerCase();
  if (ext === '.apk') {
    console.log(`\n  APK 설치 중...`);
    await installApkFile(serial, targetPath);
  } else {
    await installXapk(serial, targetPath);
  }
}
