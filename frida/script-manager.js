import frida from 'frida';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET_PKG, getDeviceSpoof, getFridaHooks } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 모듈 파일 로드 순서 (의존성 순)
const SCRIPT_MODULES = [
    // bypass 모듈
    'scripts/bypass/anti-detect.js',
    'scripts/bypass/anti-kill.js',
    'scripts/bypass/nfilter.js',
    'scripts/bypass/device-spoof.js',
    // hooks 모듈
    'scripts/hooks/activity.js',
    'scripts/hooks/sharedpref.js',
    'scripts/hooks/kakaotalk-app.js',
    'scripts/hooks/loco-monitor.js',
    'scripts/hooks/http-monitor.js',
    // 메인 로더 (항상 마지막)
    'scripts/loader.js',
];

function loadScriptSource() {
    // config.json 값을 frida 스크립트에 주입
    const injected = `
const DEVICE_PROFILE = ${JSON.stringify(getDeviceSpoof(), null, 4)};
const HOOK_CONFIG = ${JSON.stringify(getFridaHooks(), null, 4)};
const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'trace'];

function normalizeLevel(level) {
    const normalized = String(level || 'info').toLowerCase();
    return LOG_LEVELS.includes(normalized) ? normalized : 'info';
}

function levelRank(level) {
    return LOG_LEVELS.indexOf(normalizeLevel(level));
}

function getScriptConfig(script) {
    const defaultLevel = normalizeLevel(HOOK_CONFIG && HOOK_CONFIG.globalLogLevel);
    const found = HOOK_CONFIG && HOOK_CONFIG.scripts && HOOK_CONFIG.scripts[script];
    if (!found) return { enabled: true, logLevel: defaultLevel };

    return {
        enabled: found.enabled !== false,
        logLevel: normalizeLevel(found.logLevel || defaultLevel),
    };
}

function isScriptEnabled(script) {
    return getScriptConfig(script).enabled;
}

function shouldLog(script, level) {
    const cfg = getScriptConfig(script);
    if (!cfg.enabled) return false;
    return levelRank(normalizeLevel(level)) <= levelRank(cfg.logLevel);
}

function emitLog(script, level, msg) {
    if (!shouldLog(script, level)) return;
    send({ type: 'log', script, level: normalizeLevel(level), msg });
}

function emitEvent(script, payload, minLevel) {
    const gateLevel = normalizeLevel(minLevel || 'info');
    if (!shouldLog(script, gateLevel)) return;
    send(Object.assign({ script }, payload));
}
`;
    const modules = SCRIPT_MODULES
        .map(f => readFileSync(resolve(__dirname, f), 'utf-8'))
        .join('\n\n');
    return injected + '\n\n' + modules;
}

function setupMessageHandler(script) {
    script.message.connect((message) => {
        if (message.type === 'send') {
            const payload = message.payload;
            if (!payload) return;

            switch (payload.type) {
                case 'log': {
                    const level = payload.level || 'info';
                    let pfx, color;
                    switch (level) {
                        case 'error': pfx = '✗'; color = '\x1b[31m'; break;
                        case 'warn':  pfx = '⚠'; color = '\x1b[33m'; break;
                        case 'debug': pfx = '·'; color = '\x1b[2m'; break;
                        case 'trace': pfx = '·'; color = '\x1b[2m'; break;
                        default:      pfx = '→'; color = ''; break;
                    }
                    const scope = payload.script ? `[${payload.script}] ` : '';
                    const reset = color ? '\x1b[0m' : '';
                    console.log(`  ${color}${pfx} ${scope}${payload.msg}${reset}`);
                    break;
                }
                case 'activity':
                    console.log(`  [Activity] ${payload.event}: ${payload.name}`);
                    break;
                case 'sharedpref':
                    console.log(`  [SharedPref] ${payload.key} = ${payload.value}`);
                    break;
                case 'http': {
                    const PAD_HTTP = '          ';
                    const prettyHttpBody = (body) => {
                        if (!body) return null;
                        const s = typeof body === 'string' ? body : JSON.stringify(body);
                        try {
                            const parsed = JSON.parse(s);
                            const json = JSON.stringify(parsed, null, 2);
                            return json.split('\n').map((line, i) => i === 0 ? line : PAD_HTTP + line).join('\n');
                        } catch (_) {
                            return s;
                        }
                    };
                    const printHeaders = (headers) => {
                        if (!headers) return;
                        for (const [k, v] of Object.entries(headers)) {
                            console.log(`${PAD_HTTP}\x1b[2m${k}: ${v}\x1b[0m`);
                        }
                    };
                    if (payload.event === 'request') {
                        console.log(`  \x1b[33m[HTTP]\x1b[0m \x1b[33m→\x1b[0m \x1b[1m${payload.method}\x1b[0m ${payload.url}`);
                        printHeaders(payload.headers);
                        const rb = prettyHttpBody(payload.body);
                        if (rb) console.log(`${PAD_HTTP}${rb}`);
                    } else if (payload.event === 'response') {
                        const codeColor = payload.code < 400 ? '\x1b[32m' : '\x1b[31m';
                        console.log(`  \x1b[33m[HTTP]\x1b[0m \x1b[32m←\x1b[0m ${codeColor}${payload.code}\x1b[0m ${payload.url}`);
                        printHeaders(payload.headers);
                        const rb = prettyHttpBody(payload.body);
                        if (rb) console.log(`${PAD_HTTP}${rb}`);
                    } else {
                        console.log(`  \x1b[33m[HTTP]\x1b[0m ${payload.event}: ${payload.url}`);
                    }
                    break;
                }
                case 'loco': {
                    const ev = payload.event;
                    const PAD = '           '; // 11칸 들여쓰기

                    // body 포맷: 컬러 + Long 구분 + 컴팩트
                    const colorVal = (v) => {
                        if (v === null || v === undefined) return '\x1b[2mnull\x1b[0m';
                        if (typeof v === 'boolean') return v ? '\x1b[33mtrue\x1b[0m' : '\x1b[33mfalse\x1b[0m';
                        if (typeof v === 'number') {
                            // Long-like (> 10자리) → 다른 색
                            if (Math.abs(v) > 9999999999) return `\x1b[35m${v}\x1b[0m`;
                            return `\x1b[36m${v}\x1b[0m`;
                        }
                        if (typeof v === 'string') {
                            return `\x1b[32m"${v}"\x1b[0m`;
                        }
                        return String(v);
                    };

                    const formatBody = (body, indent) => {
                        if (!body) return null;
                        if (typeof body === 'string') {
                            return body;
                        }
                        indent = indent || 0;
                        const prefix = PAD + '  '.repeat(indent);
                        if (Array.isArray(body)) {
                            if (body.length === 0) return '[]';
                            // 짧은 primitive 배열은 한줄로
                            if (body.length <= 5 && body.every(v => typeof v !== 'object' || v === null)) {
                                return '[' + body.map(v => colorVal(v)).join(', ') + ']';
                            }
                            const lines = body.map(v => {
                                if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
                                    return prefix + '  ' + formatBody(v, indent + 1);
                                }
                                return prefix + '  ' + colorVal(v);
                            });
                            return '[\n' + lines.join(',\n') + '\n' + prefix + ']';
                        }
                        if (typeof body === 'object') {
                            const keys = Object.keys(body);
                            if (keys.length === 0) return '{}';
                            // 키-값 쌍이 적고 값이 짧으면 한줄로
                            const isCompact = keys.length <= 4 && keys.every(k => {
                                const v = body[k];
                                return v === null || typeof v !== 'object';
                            });
                            if (isCompact) {
                                const pairs = keys.map(k => `\x1b[37m${k}\x1b[0m=${colorVal(body[k])}`);
                                return '{ ' + pairs.join(', ') + ' }';
                            }
                            const lines = keys.map(k => {
                                const v = body[k];
                                if (typeof v === 'object' && v !== null) {
                                    return prefix + '  ' + `\x1b[37m${k}\x1b[0m: ` + formatBody(v, indent + 1);
                                }
                                return prefix + '  ' + `\x1b[37m${k}\x1b[0m: ` + colorVal(v);
                            });
                            return '{\n' + lines.join(',\n') + '\n' + prefix + '}';
                        }
                        return colorVal(body);
                    };

                    const printBody = (body) => {
                        const formatted = formatBody(body);
                        if (formatted) console.log(`${PAD}${formatted}`);
                    };

                    if (ev === 'send') {
                        const m = payload.method || '?';
                        const parts = [];
                        if (payload.packetId != null && payload.packetId !== -1) parts.push(`pid=${payload.packetId}`);
                        if (payload.bodyLength != null && payload.bodyLength !== -1) parts.push(`${payload.bodyLength}B`);
                        const suffix = parts.length ? ` \x1b[2m${parts.join(' ')}\x1b[0m` : '';
                        console.log(`  \x1b[36m[LOCO]\x1b[0m \x1b[33m→\x1b[0m \x1b[1m${m}\x1b[0m${suffix}`);
                        printBody(payload.body);
                    } else if (ev === 'recv') {
                        const m = payload.method || '?';
                        const parts = [];
                        if (payload.packetId != null && payload.packetId !== -1) parts.push(`pid=${payload.packetId}`);
                        if (payload.status != null && payload.status !== -1 && payload.status !== 0) parts.push(`st=${payload.status}`);
                        if (payload.bodyLength != null && payload.bodyLength !== -1) parts.push(`${payload.bodyLength}B`);
                        const suffix = parts.length ? ` \x1b[2m${parts.join(' ')}\x1b[0m` : '';
                        console.log(`  \x1b[36m[LOCO]\x1b[0m \x1b[32m←\x1b[0m \x1b[1m${m}\x1b[0m${suffix}`);
                        printBody(payload.body);
                    } else if (ev === 'push') {
                        const m = payload.method || '?';
                        const parts = [];
                        if (payload.packetId != null) parts.push(`pid=${payload.packetId}`);
                        if (payload.bodyLength != null) parts.push(`${payload.bodyLength}B`);
                        const suffix = parts.length ? ` \x1b[2m${parts.join(' ')}\x1b[0m` : '';
                        console.log(`  \x1b[36m[LOCO]\x1b[0m \x1b[35m◀\x1b[0m \x1b[1;35mPUSH ${m}\x1b[0m${suffix}`);
                        printBody(payload.body);
                    } else if (ev === 'connect' || ev === 'socket_connect') {
                        console.log(`  \x1b[36m[LOCO]\x1b[0m \x1b[32m●\x1b[0m ${payload.host}${payload.timeout ? ` \x1b[2mtimeout=${payload.timeout}ms\x1b[0m` : ''}`);
                    } else if (ev === 'disconnect' || ev === 'socket_close') {
                        console.log(`  \x1b[36m[LOCO]\x1b[0m \x1b[31m○\x1b[0m disconnected`);
                    } else {
                        console.log(`  \x1b[36m[LOCO]\x1b[0m ${ev || 'event'} ${JSON.stringify(payload)}`);
                    }
                    break;
                }
                default:
                    console.log(`  [msg] ${JSON.stringify(payload)}`);
            }
        } else if (message.type === 'error') {
            console.error(`  [script error] ${message.stack || message.description}`);
        }
    });
}

async function getDevice(serial) {
    const mgr = frida.getDeviceManager();
    const devices = await mgr.enumerateDevices();

    if (serial) {
        // ADB serial로 frida 디바이스 매칭 (id 또는 name에 serial 포함)
        const match = devices.find(d =>
            d.type !== 'local' && (d.id === serial || d.id.includes(serial) || d.name.includes(serial))
        );
        if (match) return match;

        // 에뮬레이터인 경우 (emulator-XXXX) → TCP 연결 시도
        if (serial.startsWith('emulator-')) {
            // frida는 에뮬레이터를 USB 디바이스로 인식하기도 함
            const usbDevices = devices.filter(d => d.type === 'usb');
            if (usbDevices.length === 1) return usbDevices[0];
            if (usbDevices.length > 1) {
                // 여러 USB 디바이스 중 에뮬레이터 찾기
                const emu = usbDevices.find(d => d.name.toLowerCase().includes('emulator') || d.id.includes('emulator'));
                if (emu) return emu;
                return usbDevices[0];
            }
        }

        // 마지막 시도: 사용 가능한 비-local 디바이스 중 첫 번째
        const remote = devices.find(d => d.type !== 'local');
        if (remote) {
            console.log(`  ⚠ serial '${serial}'과 정확히 매칭되는 frida 디바이스 없음, '${remote.id}' 사용`);
            return remote;
        }

        throw new Error(`frida 디바이스를 찾을 수 없습니다. frida-server가 실행 중인지 확인하세요.`);
    }

    // serial 없으면 USB 디바이스 자동 선택
    return frida.getUsbDevice({ timeout: 5000 });
}

export async function spawnAndHook(serial) {
    console.log(`\n  [Spawn] ${TARGET_PKG} 시작 중...`);
    const device = await getDevice(serial);
    console.log(`  디바이스: ${device.name} (${device.id})`);

    const pid = await device.spawn([TARGET_PKG]);
    console.log(`  PID: ${pid}`);

    const session = await device.attach(pid);
    session.detached.connect((reason) => {
        console.log(`\n  [!] 세션 종료: ${reason}`);
    });

    const script = await session.createScript(loadScriptSource());
    setupMessageHandler(script);
    await script.load();

    await device.resume(pid);
    console.log(`  [+] 앱 resume 완료. 훅 활성 상태.\n`);
    console.log(`  Ctrl+C로 종료하세요.\n`);

    return { device, session, script, pid };
}

export async function attachAndHook(serial) {
    console.log(`\n  [Attach] ${TARGET_PKG} 에 연결 중...`);
    const device = await getDevice(serial);
    console.log(`  디바이스: ${device.name} (${device.id})`);

    const session = await device.attach(TARGET_PKG);
    session.detached.connect((reason) => {
        console.log(`\n  [!] 세션 종료: ${reason}`);
    });

    const script = await session.createScript(loadScriptSource());
    setupMessageHandler(script);
    await script.load();

    console.log(`  [+] Attach 완료. 훅 활성 상태.\n`);
    console.log(`  Ctrl+C로 종료하세요.\n`);

    return { device, session, script };
}
