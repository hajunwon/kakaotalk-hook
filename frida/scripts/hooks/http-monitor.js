// http-monitor.js - OkHttp 요청·응답 로깅
// R8 난독화 대응: reflection 자동 탐색 + APK 분석 확인 사실 기반
// 확인된 매핑: okhttp3.i=Headers, headers.j()=toMultimap(), Bx0.e=okio.Buffer
// 중복 방지: interceptor chain 최상단(index===0)에서만 로깅

var _bufferClass = null;
var _methodCache = {};    // cls#signature → methodName

function installHttpMonitor() {
    _hookOkHttpChain();
    emitLog('http-monitor', 'info', 'HTTP 모니터 설치 완료');
}

// ── method discovery ────────────────────────────────────

// 클래스의 메서드 시그니처를 한번만 로그로 출력 (디버그용)
var _discoveredClasses = {};
function _discoverAndLog(obj, label) {
    var cls = obj.getClass().getName();
    if (_discoveredClasses[cls]) return;
    _discoveredClasses[cls] = true;

    var sigs = [];
    try {
        var methods = obj.getClass().getDeclaredMethods();
        for (var i = 0; i < methods.length; i++) {
            var m = methods[i];
            var params = [];
            var pt = m.getParameterTypes();
            for (var j = 0; j < pt.length; j++) params.push(pt[j].getName());
            sigs.push(m.getName() + '(' + params.join(',') + ')→' + m.getReturnType().getName());
        }
    } catch (_) {}
    emitLog('http-monitor', 'debug', label + ' [' + cls + ']: ' + sigs.join(' | '));
}

// reflection으로 메서드 이름 찾기 (캐싱)
// retType: 정확한 반환 타입 이름 (null이면 무시)
// paramTypes: 파라미터 타입 배열 (null이면 paramCount만 체크)
// paramCount: 파라미터 수 (paramTypes가 있으면 무시)
function _resolveMethod(obj, retType, paramTypes, paramCount, hint) {
    var cls = obj.getClass().getName();
    var key = cls + '#' + hint;
    if (_methodCache[key] !== undefined) return _methodCache[key];

    try {
        var methods = obj.getClass().getDeclaredMethods();
        for (var i = 0; i < methods.length; i++) {
            var m = methods[i];
            if (retType !== null && m.getReturnType().getName() !== retType) continue;

            var mp = m.getParameterTypes();
            if (paramTypes !== null) {
                if (mp.length !== paramTypes.length) continue;
                var ok = true;
                for (var k = 0; k < mp.length; k++) {
                    if (mp[k].getName() !== paramTypes[k]) { ok = false; break; }
                }
                if (!ok) continue;
            } else if (paramCount !== null) {
                if (mp.length !== paramCount) continue;
            }

            _methodCache[key] = m.getName();
            emitLog('http-monitor', 'debug', 'resolved ' + hint + ': ' + cls + '.' + m.getName());
            return m.getName();
        }
    } catch (_) {}

    _methodCache[key] = null;
    return null;
}

// Buffer-assignable 파라미터를 가진 메서드 찾기 (writeTo 탐색용)
// 반환: { name, paramType } 또는 null
function _resolveWriteTo(rb, buf) {
    var cls = rb.getClass().getName();
    var key = cls + '#writeTo';
    if (_methodCache[key] !== undefined) return _methodCache[key];

    var bufJavaClass = buf.getClass();
    var allMethods = [];
    try { allMethods = allMethods.concat(Array.prototype.slice.call(rb.getClass().getDeclaredMethods())); } catch (_) {}
    try { allMethods = allMethods.concat(Array.prototype.slice.call(rb.getClass().getMethods())); } catch (_) {}
    var seen = {};
    for (var i = 0; i < allMethods.length; i++) {
        var m = allMethods[i];
        var mp = m.getParameterTypes();
        if (mp.length !== 1) continue;
        var name = m.getName();
        var paramName = mp[0].getName();
        var sig = name + '(' + paramName + ')';
        if (seen[sig]) continue;
        seen[sig] = true;
        // java.lang.Object, Serializable 등 범용 타입 제외
        if (paramName.startsWith('java.lang.') || paramName.startsWith('java.io.Serializable')) continue;
        try {
            if (mp[0].isAssignableFrom(bufJavaClass)) {
                var result = { name: name, paramType: paramName };
                _methodCache[key] = result;
                emitLog('http-monitor', 'debug', 'resolved writeTo: ' + cls + '.' + name + '(' + paramName + ')');
                return result;
            }
        } catch (_) {}
    }

    _methodCache[key] = null;
    return null;
}

// ── okio Buffer ─────────────────────────────────────────

function _getBufferClass() {
    if (_bufferClass) return _bufferClass;
    var names = ['okio.Buffer', 'Bx0.e', 'Bx0.C9797e'];
    for (var i = 0; i < names.length; i++) {
        try { _bufferClass = Java.use(names[i]); return _bufferClass; } catch (_) {}
    }
    return null;
}

function _isObjToString(s) {
    return /^[A-Za-z0-9$._]+@[0-9a-f]+$/.test(s);
}

// Buffer → UTF-8 문자열 (reflection 자동 탐색, 상속 메서드 포함)
function _readBufferUtf8(buf) {
    if (!buf) return null;
    _discoverAndLog(buf, 'Buffer');

    // getDeclaredMethods + getMethods 모두 수집 (상속된 readUtf8 등 포함)
    var allMethods = [];
    var seen = {};
    try { allMethods = allMethods.concat(Array.prototype.slice.call(buf.getClass().getDeclaredMethods())); } catch (_) {}
    try { allMethods = allMethods.concat(Array.prototype.slice.call(buf.getClass().getMethods())); } catch (_) {}

    // 1차: readString(Charset) 시도 — readUtf8()보다 확실
    for (var i = 0; i < allMethods.length; i++) {
        var m = allMethods[i];
        var name = m.getName();
        if (seen['str1_' + name]) continue;
        seen['str1_' + name] = true;
        if (m.getReturnType().getName() === 'java.lang.String' && m.getParameterTypes().length === 1) {
            var ptype = m.getParameterTypes()[0].getName();
            if (ptype === 'java.nio.charset.Charset') {
                try {
                    var utf8 = Java.use('java.nio.charset.StandardCharsets').UTF_8.value;
                    var val = buf[name](utf8);
                    if (val != null) {
                        var s = '' + val;
                        if (s.length > 0 && !_isObjToString(s)) {
                            emitLog('http-monitor', 'debug', 'buffer: readString(Charset) resolved as ' + name);
                            return s;
                        }
                    }
                } catch (_) {}
            }
        }
    }

    // 2차: String 반환 no-arg 메서드 (readUtf8 등)
    for (var i = 0; i < allMethods.length; i++) {
        var m = allMethods[i];
        var name = m.getName();
        if (seen['str0_' + name]) continue;
        seen['str0_' + name] = true;
        if (m.getReturnType().getName() === 'java.lang.String' && m.getParameterTypes().length === 0) {
            try {
                var val = buf[name]();
                if (val != null) {
                    var s = '' + val;
                    if (s.length > 0 && !_isObjToString(s)) {
                        emitLog('http-monitor', 'debug', 'buffer: readUtf8 resolved as ' + name);
                        return s;
                    }
                }
            } catch (_) {}
        }
    }

    // 3차: byte[] 반환 no-arg → String 변환
    for (var i = 0; i < allMethods.length; i++) {
        var m = allMethods[i];
        var name = m.getName();
        if (seen['byte_' + name]) continue;
        seen['byte_' + name] = true;
        if (m.getReturnType().getName() === '[B' && m.getParameterTypes().length === 0) {
            try {
                var bytes = buf[name]();
                if (bytes && bytes.length > 0) {
                    emitLog('http-monitor', 'debug', 'buffer: readByteArray resolved as ' + name);
                    return Java.use('java.lang.String').$new(bytes, 'UTF-8');
                }
            } catch (_) {}
        }
    }

    // 4차: buf.size() 체크해서 디버그 정보 제공
    try {
        var sizeMethod = _resolveMethod(buf, 'long', null, 0, 'buffer_size');
        if (sizeMethod) {
            var sz = buf[sizeMethod]();
            emitLog('http-monitor', 'debug', 'buffer: size=' + sz + ' but no read method worked');
        }
    } catch (_) {}

    return null;
}

// RequestBody → Buffer에 쓰기 (reflection으로 writeTo 탐색)
function _writeBodyToBuffer(rb, buf) {
    _discoverAndLog(rb, 'RequestBody');

    var resolved = _resolveWriteTo(rb, buf);
    if (!resolved) {
        emitLog('http-monitor', 'debug', 'writeTo 메서드 찾지 못함: ' + rb.getClass().getName());
        return false;
    }

    // 1차: explicit overload — R8 난독화된 인터페이스 타입 명시
    try {
        rb[resolved.name].overload(resolved.paramType).call(rb, buf);
        return true;
    } catch (e) {
        emitLog('http-monitor', 'debug', 'writeTo overload(' + resolved.paramType + ') 실패: ' + e.message);
    }

    // 2차: Frida 자동 디스패치
    try {
        rb[resolved.name](buf);
        return true;
    } catch (e) {
        emitLog('http-monitor', 'debug', 'writeTo direct 실패: ' + e.message);
    }

    return false;
}

// ── Headers (reflection으로 toMultimap 탐색) ──

function _extractHeaders(h) {
    if (!h) return null;
    _discoverAndLog(h, 'Headers');
    var hdrs = {};

    // 1차: reflection으로 Map 반환 no-arg 메서드 찾기 (toMultimap)
    var allMethods = [];
    try { allMethods = allMethods.concat(Array.prototype.slice.call(h.getClass().getDeclaredMethods())); } catch (_) {}
    try { allMethods = allMethods.concat(Array.prototype.slice.call(h.getClass().getMethods())); } catch (_) {}
    var tried = {};
    for (var i = 0; i < allMethods.length; i++) {
        var m = allMethods[i];
        var name = m.getName();
        if (tried[name]) continue;
        tried[name] = true;
        var ret = m.getReturnType().getName();
        if (m.getParameterTypes().length === 0 && (ret === 'java.util.Map' || ret.indexOf('Map') >= 0)) {
            try {
                var map = h[name]();
                if (map) {
                    var iter = map.entrySet().iterator();
                    while (iter.hasNext()) {
                        var entry = iter.next();
                        var key = '' + entry.getKey();
                        var values = entry.getValue();
                        hdrs[key] = '' + values.get(0);
                    }
                    if (Object.keys(hdrs).length > 0) {
                        emitLog('http-monitor', 'debug', 'headers: toMultimap resolved as ' + name + '()');
                        break;
                    }
                }
            } catch (_) {}
        }
    }

    // 2차 fallback: toString() 파싱
    if (Object.keys(hdrs).length === 0) {
        try {
            var str = '' + h.toString();
            if (str && str.indexOf(':') > 0 && !_isObjToString(str)) {
                var lines = str.split('\n');
                for (var i = 0; i < lines.length; i++) {
                    var line = ('' + lines[i]).trim();
                    if (!line) continue;
                    var idx = line.indexOf(':');
                    if (idx > 0) {
                        hdrs[line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
                    }
                }
            }
        } catch (_) {}
    }

    return Object.keys(hdrs).length > 0 ? hdrs : null;
}

// ── ResponseBody 읽기 ───────────────────────────────────

function _readResponseBody(rb) {
    if (!rb) return null;
    _discoverAndLog(rb, 'ResponseBody');

    // getDeclaredMethods + getMethods 모두 수집 (상속된 string() 포함)
    var allMethods = [];
    var seen = {};
    try { allMethods = allMethods.concat(Array.prototype.slice.call(rb.getClass().getDeclaredMethods())); } catch (_) {}
    try { allMethods = allMethods.concat(Array.prototype.slice.call(rb.getClass().getMethods())); } catch (_) {}

    // 1차: String 반환 no-arg (string() 등)
    for (var i = 0; i < allMethods.length; i++) {
        var m = allMethods[i];
        var name = m.getName();
        if (seen['str_' + name]) continue;
        seen['str_' + name] = true;
        if (m.getReturnType().getName() === 'java.lang.String' && m.getParameterTypes().length === 0) {
            try {
                var val = rb[name]();
                if (val != null) {
                    var s = '' + val;
                    if (s.length > 0 && !_isObjToString(s)) {
                        emitLog('http-monitor', 'debug', 'respBody: string() resolved as ' + name);
                        return s;
                    }
                }
            } catch (_) {}
        }
    }

    // 2차: byte[] 반환 no-arg
    for (var i = 0; i < allMethods.length; i++) {
        var m = allMethods[i];
        var name = m.getName();
        if (seen['byte_' + name]) continue;
        seen['byte_' + name] = true;
        if (m.getReturnType().getName() === '[B' && m.getParameterTypes().length === 0) {
            try {
                var bytes = rb[name]();
                if (bytes && bytes.length > 0) {
                    emitLog('http-monitor', 'debug', 'respBody: bytes() resolved as ' + name);
                    return Java.use('java.lang.String').$new(bytes, 'UTF-8');
                }
            } catch (_) {}
        }
    }

    // 3차: source() → Buffer → readUtf8 체인
    for (var i = 0; i < allMethods.length; i++) {
        var m = allMethods[i];
        var name = m.getName();
        if (seen['src_' + name]) continue;
        seen['src_' + name] = true;
        var ret = m.getReturnType().getName();
        if (m.getParameterTypes().length === 0 && (ret.indexOf('BufferedSource') >= 0 || ret.indexOf('Source') >= 0)) {
            try {
                var source = rb[name]();
                if (source) {
                    var BufClass = _getBufferClass();
                    if (BufClass) {
                        var buf = BufClass.$new();
                        // source.readAll(buf) 시도
                        var sourceMethods = [];
                        try { sourceMethods = sourceMethods.concat(Array.prototype.slice.call(source.getClass().getMethods())); } catch (_) {}
                        for (var j = 0; j < sourceMethods.length; j++) {
                            var sm = sourceMethods[j];
                            if (sm.getParameterTypes().length === 1) {
                                try {
                                    if (sm.getParameterTypes()[0].isAssignableFrom(buf.getClass())) {
                                        source[sm.getName()](buf);
                                        var result = _readBufferUtf8(buf);
                                        if (result) {
                                            emitLog('http-monitor', 'debug', 'respBody: source→buffer chain worked via ' + name + '→' + sm.getName());
                                            return result;
                                        }
                                    }
                                } catch (_) {}
                            }
                        }
                    }
                }
            } catch (_) {}
        }
    }

    return null;
}

// ── Interceptor Hook ────────────────────────────────────

function _hookOkHttpChain() {
    try {
        var Chain = Java.use('okhttp3.internal.http.RealInterceptorChain');

        var indexFieldName = null;
        var fields = Chain.class.getDeclaredFields();
        for (var fi = 0; fi < fields.length; fi++) {
            if (fields[fi].getType().getName() === 'int') {
                var fname = fields[fi].getName();
                if (fname === 'index' || fname.length <= 2) {
                    indexFieldName = fname;
                    break;
                }
            }
        }

        Chain.proceed.overload('okhttp3.Request').implementation = function (req) {
            var isFirst = false;
            try {
                if (indexFieldName) {
                    var idx = this[indexFieldName].value;
                    isFirst = (idx === 0);
                }
            } catch (_) { isFirst = true; }

            if (isFirst) _logReq(req);
            var resp;
            try {
                resp = this.proceed(req);
            } catch (e) {
                if (isFirst) emitLog('http-monitor', 'warn', 'proceed 예외: ' + e.message);
                throw e;
            }
            if (isFirst) _logResp(req, resp);
            return resp;
        };
        emitLog('http-monitor', 'info', 'RealInterceptorChain.proceed 후킹 성공 (indexField=' + indexFieldName + ')');
    } catch (e) {
        emitLog('http-monitor', 'warn', 'RealInterceptorChain.proceed 후킹 실패: ' + e.message);
    }
}

// ── 요청 로깅 ───────────────────────────────────────────

function _logReq(req) {
    try {
        var url = req.url().toString();
        var method = req.method();
        var isDebug = shouldLog('http-monitor', 'debug');

        var headers = null;
        if (isDebug) {
            try { headers = _extractHeaders(req.headers()); }
            catch (e) { emitLog('http-monitor', 'debug', 'req headers 실패: ' + e.message); }
        }

        var body = null;
        var rb = req.body();
        if (rb) {
            try {
                var BufClass = _getBufferClass();
                if (BufClass) {
                    var buf = BufClass.$new();
                    if (_writeBodyToBuffer(rb, buf)) {
                        body = _readBufferUtf8(buf);
                        if (!body) emitLog('http-monitor', 'debug', 'req body: buffer→string 실패 (빈 버퍼?)');
                    } else {
                        emitLog('http-monitor', 'debug', 'req body: writeTo 메서드 없음');
                    }
                } else {
                    emitLog('http-monitor', 'debug', 'okio.Buffer 클래스 없음');
                }
            } catch (e) {
                emitLog('http-monitor', 'debug', 'req body 실패: ' + e.message);
            }
            if (body && body.length > 1024) body = body.substring(0, 1024) + '...';
        }

        send({ type: 'http', event: 'request', method: method, url: url, headers: headers, body: body });
    } catch (e) {
        emitLog('http-monitor', 'debug', '_logReq 실패: ' + e.message);
    }
}

// ── 응답 로깅 ───────────────────────────────────────────

function _logResp(req, resp) {
    try {
        var url = req.url().toString();
        var code = resp.code();
        var isDebug = shouldLog('http-monitor', 'debug');

        var headers = null;
        if (isDebug) {
            try { headers = _extractHeaders(resp.headers()); }
            catch (e) { emitLog('http-monitor', 'debug', 'resp headers 실패: ' + e.message); }
        }

        var body = null;
        try {
            var peeked = null;
            try { peeked = resp.peekBody(32768); } catch (_) {}

            // reflection fallback: long 파라미터 메서드 찾기
            if (!peeked) {
                try {
                    var methods = resp.getClass().getDeclaredMethods();
                    for (var i = 0; i < methods.length; i++) {
                        var m = methods[i];
                        var params = m.getParameterTypes();
                        if (params.length === 1 && params[0].getName() === 'long') {
                            try { peeked = resp[m.getName()](32768); break; } catch (_) {}
                        }
                    }
                } catch (_) {}
            }

            if (peeked) {
                body = _readResponseBody(peeked);
                if (!body) emitLog('http-monitor', 'debug', 'resp body: ResponseBody→string 실패');
            } else {
                emitLog('http-monitor', 'debug', 'resp body: peekBody 실패');
            }
        } catch (e) {
            emitLog('http-monitor', 'debug', 'resp body 실패: ' + e.message);
        }

        if (body && body.length > 2048) body = body.substring(0, 2048) + '...';
        send({ type: 'http', event: 'response', code: code, url: url, headers: headers, body: body });
    } catch (e) {
        emitLog('http-monitor', 'debug', '_logResp 실패: ' + e.message);
    }
}
