import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getAdbPath } from '../config.js';

const execFileAsync = promisify(execFile);

// 에뮬레이터별로 널리 알려진 ADB 포트. 동일 포트를 여러 에뮬레이터가 공유하는
// 경우(예: 5555)는 대표 라벨 하나만 표기한다.
const KNOWN_PORTS = [
  // 5555~5585: AVD / LDPlayer / BlueStacks / Genymotion 등 공용 대역.
  //   AVD는 5555, 5557, 5559... (홀수)로 adb 포트가 배정되고,
  //   LDPlayer는 +2씩 증가하는 인스턴스 포트를 쓴다(5555, 5557, 5559...).
  { port: 5555, label: 'BlueStacks / LDPlayer / AVD / tcpip' },
  { port: 5556, label: 'LDPlayer #2' },
  { port: 5557, label: 'AVD #2 / LDPlayer' },
  { port: 5558, label: 'LDPlayer' },
  { port: 5559, label: 'AVD #3 / LDPlayer' },
  { port: 5560, label: 'LDPlayer' },
  { port: 5561, label: 'AVD #4 / LDPlayer' },
  { port: 5562, label: 'LDPlayer' },
  { port: 5563, label: 'AVD #5' },
  { port: 5565, label: 'AVD #6' },
  { port: 5567, label: 'AVD #7' },
  { port: 5569, label: 'AVD #8' },
  { port: 5575, label: 'AVD' },
  { port: 5585, label: 'AVD' },

  // NoxPlayer
  { port: 62001, label: 'NoxPlayer' },
  { port: 62025, label: 'NoxPlayer #2' },
  { port: 62026, label: 'NoxPlayer #3' },
  { port: 62027, label: 'NoxPlayer #4' },
  { port: 62028, label: 'NoxPlayer #5' },
  { port: 62029, label: 'NoxPlayer #6' },
  { port: 62030, label: 'NoxPlayer #7' },

  // MEmu (10 단위 증가)
  { port: 21503, label: 'MEmu' },
  { port: 21513, label: 'MEmu #2' },
  { port: 21523, label: 'MEmu #3' },
  { port: 21533, label: 'MEmu #4' },
  { port: 21543, label: 'MEmu #5' },

  // MuMu — Nebula(구버전) 및 MuMu Player 12(+32 단위 증가)
  { port: 7555,  label: 'MuMu Nebula' },
  { port: 16384, label: 'MuMu Player 12 #1' },
  { port: 16416, label: 'MuMu Player 12 #2' },
  { port: 16448, label: 'MuMu Player 12 #3' },
  { port: 16480, label: 'MuMu Player 12 #4' },
  { port: 16512, label: 'MuMu Player 12 #5' },
  { port: 16544, label: 'MuMu Player 12 #6' },

  // Genymotion 클라우드/커스텀
  { port: 5037,  label: 'ADB 서버 (host)' },
];

function probePort(host, port, timeoutMs) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = result => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function adbConnect(host, port) {
  try {
    const { stdout, stderr } = await execFileAsync(
      getAdbPath(),
      ['connect', `${host}:${port}`],
      { timeout: 5000 },
    );
    const out = (stdout + stderr).trim().toLowerCase();
    // "connected to ..." / "already connected to ..." 만 성공으로 간주.
    // "cannot connect" / "failed" 는 실패.
    if (out.includes('cannot') || out.includes('failed') || out.includes('unable')) {
      return { ok: false, message: out };
    }
    if (out.includes('connected')) {
      return { ok: true, message: out };
    }
    return { ok: false, message: out };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

/**
 * 로컬호스트의 알려진 ADB 포트를 스캔해 살아있는 엔드포인트를 찾고,
 * `adb connect`를 시도한다.
 *
 * @param {object} opts
 * @param {string} [opts.host='127.0.0.1']
 * @param {number} [opts.tcpTimeoutMs=250] TCP 프로브 타임아웃
 * @param {(msg: string) => void} [opts.onProgress]
 * @returns {Promise<Array<{port: number, label: string, open: boolean, connected: boolean, message?: string}>>}
 */
export async function scanPorts(opts = {}) {
  const host = opts.host || '127.0.0.1';
  const tcpTimeoutMs = opts.tcpTimeoutMs ?? 250;
  const onProgress = opts.onProgress || (() => {});

  onProgress(`${host}에서 ${KNOWN_PORTS.length}개 포트 프로브 중...`);

  const probed = await Promise.all(
    KNOWN_PORTS.map(async entry => ({
      ...entry,
      open: await probePort(host, entry.port, tcpTimeoutMs),
    })),
  );

  const open = probed.filter(p => p.open && p.port !== 5037);
  onProgress(`열린 포트 ${open.length}개 발견. adb connect 시도 중...`);

  const results = [];
  for (const entry of probed) {
    if (!entry.open) {
      results.push({ ...entry, connected: false });
      continue;
    }
    if (entry.port === 5037) {
      // 5037은 adb 서버 자체. connect 대상이 아님.
      results.push({ ...entry, connected: false, message: 'adb 서버 포트 (스킵)' });
      continue;
    }
    const { ok, message } = await adbConnect(host, entry.port);
    results.push({ ...entry, connected: ok, message });
  }

  return results;
}

export { KNOWN_PORTS };

/**
 * 연결된 `host:port` 엔드포인트의 내부 식별자를 조회한다.
 * ro.serialno(Android 시리얼) 또는 Wi-Fi MAC을 키로 쓰면 서로 다른 호스트
 * 포트로 노출된 동일 VM을 같은 디바이스로 판단할 수 있다.
 */
async function getDeviceIdentity(endpoint) {
  try {
    const { stdout } = await execFileAsync(
      getAdbPath(),
      ['-s', endpoint, 'shell',
        'getprop ro.serialno; echo ---; ' +
        'getprop ro.boot.serialno; echo ---; ' +
        'getprop ro.product.model; echo ---; ' +
        'getprop ro.product.manufacturer; echo ---; ' +
        'cat /sys/class/net/wlan0/address 2>/dev/null'],
      { timeout: 5000 },
    );
    const [serialno, bootSerial, model, manufacturer, mac] = stdout
      .split('---')
      .map(s => s.trim());
    const key = serialno || bootSerial || mac || `${manufacturer}/${model}` || endpoint;
    return {
      key,
      serialno: serialno || bootSerial || null,
      model: model || null,
      manufacturer: manufacturer || null,
      mac: mac || null,
    };
  } catch {
    return { key: endpoint, serialno: null, model: null, manufacturer: null, mac: null };
  }
}

/**
 * scanPorts() 결과 중 connected=true 인 엔드포인트들을 내부 식별자로 그룹핑.
 * 같은 VM을 가리키는 중복 연결을 식별하는 데 사용.
 */
export async function identifyConnections(results) {
  const connected = results.filter(r => r.connected);
  const entries = await Promise.all(
    connected.map(async r => ({
      ...r,
      endpoint: `127.0.0.1:${r.port}`,
      identity: await getDeviceIdentity(`127.0.0.1:${r.port}`),
    })),
  );

  const groups = new Map();
  for (const e of entries) {
    const k = e.identity.key;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  return Array.from(groups.values());
}

export async function adbDisconnect(endpoint) {
  try {
    await execFileAsync(getAdbPath(), ['disconnect', endpoint], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
