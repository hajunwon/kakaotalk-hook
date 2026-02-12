import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import inquirer from 'inquirer';
import { getAdbPath } from '../config.js';

const execFileAsync = promisify(execFile);

function adb(...args) {
  return execFileAsync(getAdbPath(), args, { timeout: 15000 });
}

function adbForSerial(serial, ...args) {
  return execFileAsync(getAdbPath(), ['-s', serial, ...args], { timeout: 15000 });
}

export async function listDevices() {
  const { stdout } = await adb('devices');
  const lines = stdout.trim().split('\n').slice(1);
  return lines
    .map(line => {
      const [serial, status] = line.trim().split(/\s+/);
      return serial ? { serial, status } : null;
    })
    .filter(Boolean);
}

export async function selectDevice() {
  const devices = await listDevices();
  if (devices.length === 0) {
    throw new Error('연결된 디바이스가 없습니다. USB 연결 및 USB 디버깅을 확인하세요.');
  }

  if (devices.length === 1) {
    const d = devices[0];
    console.log(`  디바이스 자동 선택: ${d.serial} (${d.status})`);
    return d.serial;
  }

  const { serial } = await inquirer.prompt([{
    type: 'list',
    name: 'serial',
    message: '디바이스를 선택하세요:',
    choices: devices.map(d => ({
      name: `${d.serial}  [${d.status}]`,
      value: d.serial,
    })),
  }]);
  return serial;
}

export async function shell(serial, cmd) {
  const { stdout } = await adbForSerial(serial, 'shell', cmd);
  return stdout.trim();
}

export async function push(serial, localPath, remotePath) {
  const { stdout } = await adbForSerial(serial, 'push', localPath, remotePath);
  return stdout.trim();
}

export async function getArch(serial) {
  const abi = await shell(serial, 'getprop ro.product.cpu.abi');
  const map = {
    'arm64-v8a': 'arm64',
    'armeabi-v7a': 'arm',
    'x86_64': 'x86_64',
    'x86': 'x86',
  };
  return map[abi] || abi;
}

export async function forward(serial, localPort, remotePort) {
  await adbForSerial(serial, 'forward', `tcp:${localPort}`, `tcp:${remotePort}`);
}
