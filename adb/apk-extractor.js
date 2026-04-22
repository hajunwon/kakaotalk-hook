import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import inquirer from 'inquirer';
import { getAdbPath, PROJECT_ROOT, TARGET_PKG } from '../config.js';
import { shell } from './device-manager.js';

const execFileAsync = promisify(execFile);

export const EXTRACT_DIR = resolve(PROJECT_ROOT, 'extracted');

export async function getApkPaths(serial, pkg) {
  const out = await shell(serial, `pm path ${pkg}`);
  if (!out) {
    throw new Error(`패키지를 찾을 수 없습니다: ${pkg}`);
  }
  return out
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('package:'))
    .map(l => l.slice('package:'.length));
}

export async function getPackageVersion(serial, pkg) {
  try {
    const out = await shell(serial, `dumpsys package ${pkg} | grep -E "versionName|versionCode"`);
    const name = out.match(/versionName=(\S+)/)?.[1];
    const code = out.match(/versionCode=(\d+)/)?.[1];
    return { versionName: name || null, versionCode: code || null };
  } catch (_) {
    return { versionName: null, versionCode: null };
  }
}

export async function listThirdPartyPackages(serial) {
  const out = await shell(serial, 'pm list packages -3');
  return out
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('package:'))
    .map(l => l.slice('package:'.length))
    .sort();
}

function sanitizeForDir(s) {
  return s.replace(/[^\w.\-]/g, '_');
}

async function pullFile(serial, remotePath, localPath) {
  const adb = getAdbPath();
  await execFileAsync(adb, ['-s', serial, 'pull', remotePath, localPath], { timeout: 300000 });
}

export async function extractApk(serial, pkg, outDir) {
  const paths = await getApkPaths(serial, pkg);
  if (paths.length === 0) {
    throw new Error(`${pkg}의 APK 경로를 가져올 수 없습니다.`);
  }

  mkdirSync(outDir, { recursive: true });

  console.log(`\n  APK 파일 ${paths.length}개 추출 시작: ${pkg}`);
  console.log(`  출력 경로: ${outDir}\n`);

  const pulled = [];
  for (const remote of paths) {
    const name = basename(remote);
    const local = join(outDir, name);
    process.stdout.write(`    ↓ ${name} ... `);
    try {
      await pullFile(serial, remote, local);
      const sizeMb = (statSync(local).size / (1024 * 1024)).toFixed(1);
      console.log(`${sizeMb} MB`);
      pulled.push(local);
    } catch (e) {
      console.log(`실패 (${e.message})`);
      throw e;
    }
  }

  return pulled;
}

export async function promptAndExtract(serial) {
  const { mode } = await inquirer.prompt([{
    type: 'list',
    name: 'mode',
    message: '패키지 선택 방식:',
    choices: [
      { name: `기본 (${TARGET_PKG})`, value: 'default' },
      { name: '직접 입력', value: 'manual' },
      { name: '설치된 앱 목록에서 선택 (3rd-party)', value: 'list' },
      new inquirer.Separator(),
      { name: '← 뒤로', value: 'back' },
    ],
  }]);

  if (mode === 'back') return;

  let pkg;
  if (mode === 'default') {
    pkg = TARGET_PKG;
  } else if (mode === 'manual') {
    const ans = await inquirer.prompt([{
      type: 'input',
      name: 'pkg',
      message: '패키지 이름:',
      default: TARGET_PKG,
      validate: v => v && v.includes('.') ? true : '올바른 패키지 이름을 입력하세요.',
    }]);
    pkg = ans.pkg.trim();
  } else {
    console.log('\n  설치된 앱 목록 가져오는 중...');
    const packages = await listThirdPartyPackages(serial);
    if (packages.length === 0) {
      throw new Error('3rd-party 패키지가 없습니다.');
    }
    const ans = await inquirer.prompt([{
      type: 'list',
      name: 'pkg',
      message: `패키지를 선택하세요 (${packages.length}개):`,
      pageSize: 20,
      choices: packages,
    }]);
    pkg = ans.pkg;
  }

  const { versionName } = await getPackageVersion(serial, pkg);
  const suffix = versionName ? sanitizeForDir(versionName) : new Date().toISOString().slice(0, 10);
  const outDir = resolve(EXTRACT_DIR, `${pkg}-${suffix}`);

  if (existsSync(outDir)) {
    const { overwrite } = await inquirer.prompt([{
      type: 'confirm',
      name: 'overwrite',
      message: `이미 존재하는 경로입니다. 덮어쓸까요?\n    ${outDir}`,
      default: true,
    }]);
    if (!overwrite) {
      console.log('  취소됨.\n');
      return;
    }
  }

  const files = await extractApk(serial, pkg, outDir);
  console.log(`\n  추출 완료: ${files.length}개 파일`);
  console.log(`  ${outDir}\n`);
}
