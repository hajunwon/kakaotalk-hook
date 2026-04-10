import frida from 'frida';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET_PKG, getDeviceSpoof, getFridaHooks } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================
// Pretty printer — HTTP / LOCO 블록 출력
// ============================================================

const C = {
    reset: '\x1b[0m',
    dim:   '\x1b[2m',
    bold:  '\x1b[1m',
    red:   '\x1b[31m',
    green: '\x1b[32m',
    yel:   '\x1b[33m',
    blue:  '\x1b[34m',
    mag:   '\x1b[35m',
    cyan:  '\x1b[36m',
    white: '\x1b[37m',
};

// 박스 출력: ┌ 제목 │ 본문... └ 닫기
// contentLines가 비어있으면 단일 라인(─ 제목)으로 축약
function printBox(barColor, titleLine, contentLines) {
    if (!contentLines || contentLines.length === 0) {
        console.log(`  ${barColor}─${C.reset} ${titleLine}`);
        return;
    }
    console.log(`  ${barColor}┌${C.reset} ${titleLine}`);
    for (const line of contentLines) {
        if (line === '') {
            console.log(`  ${barColor}│${C.reset}`);
        } else {
            console.log(`  ${barColor}│${C.reset} ${line}`);
        }
    }
    console.log(`  ${barColor}└${C.reset}`);
}

// 단일 라인 이벤트: ▸ [scope] 내용
function printEvent(scopeColor, scope, detail) {
    console.log(`  ${C.dim}▸${C.reset} ${scopeColor}${scope}${C.reset} ${C.dim}${detail}${C.reset}`);
}

// JSON 값 색상
function colorVal(v) {
    if (v === null || v === undefined) return `${C.dim}null${C.reset}`;
    if (typeof v === 'boolean') return `${C.yel}${v}${C.reset}`;
    if (typeof v === 'number') {
        if (Math.abs(v) > 9999999999) return `${C.mag}${v}${C.reset}`;
        return `${C.cyan}${v}${C.reset}`;
    }
    if (typeof v === 'string') return `${C.green}"${v}"${C.reset}`;
    return String(v);
}

// 객체/배열을 컬러 JSON 문자열 배열로 (각 원소 = 한 줄)
function formatJsonLines(value, indent) {
    indent = indent || 0;
    const pad = '  '.repeat(indent);
    const padIn = '  '.repeat(indent + 1);

    if (value === null || typeof value !== 'object') {
        return [colorVal(value)];
    }

    // 재귀 호출 결과 병합 헬퍼
    //   inner[0]: 여는 괄호 한 글자만 있음 (padding 없음) → padIn + prefix + inner[0]
    //   inner[1..n-2]: 이미 절대 indent 포함 → 그대로
    //   inner[n-1]: 닫는 괄호 (이미 pad 포함) → 그대로 + tail
    function appendInner(lines, inner, prefix, tail) {
        if (inner.length === 1) {
            lines.push(padIn + prefix + inner[0] + tail);
            return;
        }
        lines.push(padIn + prefix + inner[0]);
        for (let j = 1; j < inner.length - 1; j++) lines.push(inner[j]);
        lines.push(inner[inner.length - 1] + tail);
    }

    if (Array.isArray(value)) {
        if (value.length === 0) return ['[]'];
        const primitives = value.every(v => v === null || typeof v !== 'object');
        if (primitives && value.length <= 6) {
            return ['[' + value.map(colorVal).join(', ') + ']'];
        }
        const lines = ['['];
        value.forEach((v, i) => {
            const inner = formatJsonLines(v, indent + 1);
            const tail = i < value.length - 1 ? ',' : '';
            appendInner(lines, inner, '', tail);
        });
        lines.push(pad + ']');
        return lines;
    }

    const keys = Object.keys(value);
    if (keys.length === 0) return ['{}'];

    // 값이 짧고 개수 적으면 한 줄로
    const compactable = keys.length <= 4 && keys.every(k => {
        const v = value[k];
        return v === null || typeof v !== 'object';
    });
    if (compactable) {
        const pairs = keys.map(k => `${C.white}${k}${C.reset}: ${colorVal(value[k])}`);
        const one = '{ ' + pairs.join(', ') + ' }';
        if (one.length < 120) return [one];
    }

    const lines = ['{'];
    keys.forEach((k, i) => {
        const inner = formatJsonLines(value[k], indent + 1);
        const tail = i < keys.length - 1 ? ',' : '';
        appendInner(lines, inner, `${C.white}${k}${C.reset}: `, tail);
    });
    lines.push(pad + '}');
    return lines;
}

// body를 블록 라인들로 변환 (문자열이면 JSON 시도, 너무 길면 축약)
const BODY_MAX_DISPLAY_LINES = 60;
const BODY_MAX_LINE_WIDTH = 500;

function wrapLongLine(line) {
    if (line.length <= BODY_MAX_LINE_WIDTH) return [line];
    const chunks = [];
    for (let i = 0; i < line.length; i += BODY_MAX_LINE_WIDTH) {
        chunks.push(line.substring(i, i + BODY_MAX_LINE_WIDTH));
    }
    return chunks;
}

function bodyToLines(body) {
    if (body === null || body === undefined) return [];
    let lines;
    if (typeof body === 'string') {
        const trimmed = body.trim();
        if (trimmed && (trimmed[0] === '{' || trimmed[0] === '[')) {
            try {
                lines = formatJsonLines(JSON.parse(trimmed), 0);
            } catch (_) {
                lines = body.split('\n').flatMap(wrapLongLine);
            }
        } else {
            lines = body.split('\n').flatMap(wrapLongLine);
        }
    } else {
        lines = formatJsonLines(body, 0);
    }

    if (lines.length > BODY_MAX_DISPLAY_LINES) {
        const extra = lines.length - BODY_MAX_DISPLAY_LINES;
        return lines.slice(0, BODY_MAX_DISPLAY_LINES).concat([
            `${C.dim}… (+${extra} more lines)${C.reset}`,
        ]);
    }
    return lines;
}

// 헤더 키 정렬 + dim 컬러
function headerLines(headers) {
    if (!headers) return [];
    const keys = Object.keys(headers);
    if (keys.length === 0) return [];
    const maxKey = Math.min(24, keys.reduce((m, k) => Math.max(m, k.length), 0));
    return keys.map(k => {
        const pad = k.length < maxKey ? ' '.repeat(maxKey - k.length) : '';
        return `${C.dim}${k}:${pad} ${headers[k]}${C.reset}`;
    });
}

function httpBarColor(payload) {
    if (payload.event === 'request') return C.yel;
    if (payload.event === 'response') return payload.code < 400 ? C.green : C.red;
    if (payload.event === 'failed') return C.red;
    return C.dim;
}

function printHttpBlock(payload) {
    const b = httpBarColor(payload);
    let title;

    if (payload.event === 'request') {
        title = `${C.yel}${C.bold}HTTP${C.reset} ${C.yel}→${C.reset} ${C.bold}${payload.method}${C.reset} ${payload.url}`;
    } else if (payload.event === 'response') {
        const codeColor = payload.code < 400 ? C.green : C.red;
        title = `${C.yel}${C.bold}HTTP${C.reset} ${codeColor}←${C.reset} ${codeColor}${C.bold}${payload.code}${C.reset} ${payload.url}`;
    } else if (payload.event === 'failed') {
        title = `${C.yel}${C.bold}HTTP${C.reset} ${C.red}✗${C.reset} ${C.bold}${payload.method}${C.reset} ${payload.url}`;
    } else {
        printBox(b, `${C.yel}${C.bold}HTTP${C.reset} ${C.dim}${payload.event}${C.reset} ${payload.url || ''}`, []);
        return;
    }

    const content = [];
    const hdrs = headerLines(payload.headers);
    if (hdrs.length) {
        for (const h of hdrs) content.push(h);
    }

    if (payload.event === 'failed' && payload.error) {
        if (content.length) content.push('');
        content.push(`${C.red}${payload.error}${C.reset}`);
    } else {
        const body = bodyToLines(payload.body);
        if (body.length) {
            if (content.length) content.push('');
            for (const bl of body) content.push(bl);
        }
    }

    printBox(b, title, content);
}

function locoBarColor(ev) {
    if (ev === 'send') return C.yel;
    if (ev === 'recv') return C.green;
    if (ev === 'push') return C.mag;
    if (ev === 'connect' || ev === 'socket_connect') return C.cyan;
    if (ev === 'disconnect' || ev === 'socket_close') return C.dim;
    return C.cyan;
}

function locoMeta(payload) {
    const parts = [];
    if (payload.packetId != null && payload.packetId !== -1) parts.push(`pid=${payload.packetId}`);
    if (payload.status != null && payload.status !== -1 && payload.status !== 0) parts.push(`st=${payload.status}`);
    if (payload.bodyLength != null && payload.bodyLength !== -1) parts.push(`${payload.bodyLength}B`);
    return parts.length ? ` ${C.dim}${parts.join(' ')}${C.reset}` : '';
}

function printLocoBlock(payload) {
    const ev = payload.event;
    const b = locoBarColor(ev);
    const m = payload.method || '?';
    const meta = locoMeta(payload);
    let title;

    if (ev === 'send') {
        title = `${C.cyan}${C.bold}LOCO${C.reset} ${C.yel}→${C.reset} ${C.bold}${m}${C.reset}${meta}`;
    } else if (ev === 'recv') {
        title = `${C.cyan}${C.bold}LOCO${C.reset} ${C.green}←${C.reset} ${C.bold}${m}${C.reset}${meta}`;
    } else if (ev === 'push') {
        title = `${C.cyan}${C.bold}LOCO${C.reset} ${C.mag}◀${C.reset} ${C.bold}${C.mag}PUSH ${m}${C.reset}${meta}`;
    } else if (ev === 'connect' || ev === 'socket_connect') {
        const to = payload.timeout ? ` ${C.dim}timeout=${payload.timeout}ms${C.reset}` : '';
        printEvent(C.cyan, 'LOCO', `${C.green}●${C.reset} ${C.dim}connect${C.reset} ${payload.host || ''}${to}`);
        return;
    } else if (ev === 'disconnect' || ev === 'socket_close') {
        printEvent(C.cyan, 'LOCO', `${C.red}○${C.reset} ${C.dim}disconnected${C.reset}`);
        return;
    } else {
        printEvent(C.cyan, 'LOCO', `${ev || 'event'}`);
        return;
    }

    const body = bodyToLines(payload.body);
    printBox(b, title, body);
}

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
                    printEvent(C.blue, 'Activity', `${payload.event} ${C.reset}${payload.name}${C.dim}`);
                    break;
                case 'sharedpref':
                    printEvent(C.mag, 'SharedPref', `${payload.key} ${C.reset}=${C.dim} ${payload.value == null ? 'null' : payload.value}`);
                    break;
                case 'http': {
                    printHttpBlock(payload);
                    break;
                }
                case 'loco': {
                    printLocoBlock(payload);
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
