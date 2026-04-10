// loco-monitor.js - LOCO 프로토콜 패킷 모니터링 (순수 runtime discovery)
//
// 전략: LocoJob(unobfuscated) 한 곳에서 모든 관련 타입을 역추적
//   1. LocoJob.f(X, Continuation) → X = LocoReq 클래스
//   2. LocoJob.v(Y) → Y = LocoRes 클래스
//   3. LocoRes.getSuperclass() → AbstractLocoPacket (header+body 필드 보유)
//   4. AbstractLocoPacket 필드 2개:
//        - 타입이 (int+short+Enum+int) 필드를 가진 것 = LocoHeader
//        - 나머지 비-primitive = LocoBody
//   5. LocoBody의 첫 non-static 필드 = BSON (Map 구현체)
//
// R8가 패키지/클래스명을 pr → xx 로 바꿔도 LocoJob만 살아있으면 전부 작동.

var _locoInstalled = false;

function installLocoMonitor() {
    if (_locoInstalled) return;

    var TAG = 'loco-monitor';
    var hookCount = 0;

    var LocoJobClass = null;
    try {
        LocoJobClass = Java.use('com.kakao.talk.core.loco.protocol.job.LocoJob');
    } catch (e) {
        emitLog(TAG, 'error', 'LocoJob 못 찾음: ' + e.message);
        return;
    }

    // ==============================================================
    // 공용 Java 참조 캐시
    // ==============================================================
    var _enumNameMethod = null;
    try { _enumNameMethod = Java.use('java.lang.Enum').class.getMethod('name'); } catch (_) {}

    var _intValueMethod = null, _longValueMethod = null;
    try { _intValueMethod = Java.use('java.lang.Number').class.getMethod('intValue'); } catch (_) {}
    try { _longValueMethod = Java.use('java.lang.Number').class.getMethod('longValue'); } catch (_) {}

    var _booleanValueMethod = null;
    try { _booleanValueMethod = Java.use('java.lang.Boolean').class.getMethod('booleanValue'); } catch (_) {}

    var _Modifier = null;
    try { _Modifier = Java.use('java.lang.reflect.Modifier'); } catch (_) {}

    function isStatic(f) {
        if (!_Modifier) return false;
        try { return _Modifier.isStatic(f.getModifiers()); } catch (_) { return false; }
    }

    function enumName(e) {
        if (!e) return null;
        try { if (_enumNameMethod) return String(_enumNameMethod.invoke(e)); } catch (_) {}
        try { return String(e); } catch (_) {}
        return null;
    }

    function unboxInt(v) {
        if (typeof v === 'number') return v;
        if (v == null) return -1;
        try { if (_intValueMethod) return _intValueMethod.invoke(v); } catch (_) {}
        try { return parseInt(String(v)); } catch (_) {}
        return -1;
    }

    function unboxLong(v) {
        if (typeof v === 'number') return v;
        if (v == null) return -1;
        try { if (_longValueMethod) return Number(_longValueMethod.invoke(v)); } catch (_) {}
        try { return parseInt(String(v)); } catch (_) {}
        return -1;
    }

    function toBool(v) {
        if (typeof v === 'boolean') return v;
        if (v == null) return false;
        try { if (_booleanValueMethod) return !!_booleanValueMethod.invoke(v); } catch (_) {}
        return String(v) === 'true';
    }

    function isJavaKotlin(name) {
        return name.indexOf('java.') === 0 || name.indexOf('kotlin.') === 0 || name.indexOf('kotlinx.') === 0;
    }

    // ==============================================================
    // Java Map/List 인터페이스 캐시 (R8 충돌 회피)
    // ==============================================================
    var _JavaMap = null, _JavaIterator = null, _JavaMapEntry = null, _JavaList = null;
    try { _JavaMap = Java.use('java.util.Map'); } catch (_) {}
    try { _JavaIterator = Java.use('java.util.Iterator'); } catch (_) {}
    try { _JavaMapEntry = Java.use('java.util.Map$Entry'); } catch (_) {}
    try { _JavaList = Java.use('java.util.List'); } catch (_) {}

    function isMap(obj) {
        if (!_JavaMap || !obj) return false;
        try { return _JavaMap.class.isInstance(obj); } catch (_) { return false; }
    }

    function isList(obj) {
        if (!_JavaList || !obj) return false;
        try { return _JavaList.class.isInstance(obj); } catch (_) { return false; }
    }

    // ==============================================================
    // Step 1: LocoJob.f(), LocoJob.v(), LocoJob.n() 메서드 시그니처 스캔
    // ==============================================================
    var reqClassName = null;
    var resClassName = null;
    var fOverloadParams = null;  // [reqType, continuationType]
    var vOverloadParam = null;
    var nOverloadParams = null;  // [resType, Function1]
    var hMethod = null;          // 메서드명 getter

    try {
        var ljMs = LocoJobClass.class.getDeclaredMethods();
        for (var i = 0; i < ljMs.length; i++) {
            var mm = ljMs[i];
            var mName = mm.getName();
            var params = mm.getParameterTypes();
            var retType = mm.getReturnType().getName();

            // f(Req, Continuation) → send
            if (mName === 'f' && params.length === 2 &&
                params[1].getName() === 'kotlin.coroutines.Continuation' &&
                !isJavaKotlin(params[0].getName())) {
                reqClassName = params[0].getName();
                fOverloadParams = [params[0].getName(), params[1].getName()];
            }

            // v(Res) → void
            if (mName === 'v' && params.length === 1 &&
                retType === 'void' && !isJavaKotlin(params[0].getName())) {
                resClassName = params[0].getName();
                vOverloadParam = params[0].getName();
            }

            // n(Res, Function1) → Res
            if (mName === 'n' && params.length === 2 &&
                params[1].getName() === 'kotlin.jvm.functions.Function1' &&
                !isJavaKotlin(params[0].getName())) {
                nOverloadParams = [params[0].getName(), params[1].getName()];
                if (!resClassName) resClassName = params[0].getName();
            }

            // h() → LocoMethod enum
            if (mName === 'h' && params.length === 0 && !isJavaKotlin(retType) &&
                retType !== 'void' && retType !== 'int' && retType !== 'long' &&
                retType !== 'short' && retType !== 'boolean' && retType !== 'byte') {
                mm.setAccessible(true);
                hMethod = mm;
            }
        }
    } catch (e) {
        emitLog(TAG, 'error', 'LocoJob 메서드 스캔 실패: ' + e.message);
        return;
    }

    if (!reqClassName && !resClassName) {
        emitLog(TAG, 'error', 'LocoReq/LocoRes 클래스 추론 실패');
        return;
    }

    emitLog(TAG, 'debug', 'discovered req=' + reqClassName + ' res=' + resClassName + ' h()=' + (hMethod ? 'ok' : 'null'));

    // ==============================================================
    // Step 2: AbstractLocoPacket 추론 (LocoRes or LocoReq의 superclass)
    // ==============================================================
    var pktAbstractClassName = null;
    try {
        var seedName = resClassName || reqClassName;
        var seedClass = Java.use(seedName);
        var parent = seedClass.class.getSuperclass();
        if (parent) {
            var parentName = parent.getName();
            if (parentName !== 'java.lang.Object') {
                pktAbstractClassName = parentName;
            }
        }
    } catch (e) {
        emitLog(TAG, 'debug', 'AbstractLocoPacket 추론 실패: ' + e.message);
    }

    // ==============================================================
    // Step 3: AbstractLocoPacket의 header/body 필드 식별
    //   - LocoHeader: (int + short + Enum + int) 필드 보유
    //   - LocoBody: non-primitive 필드 1개 이상 (BSON 보유)
    // ==============================================================
    var _headerField = null;
    var _bodyField = null;
    var _bsonField = null;
    var _headerClassName = null;
    var _bodyClassName = null;

    function inspectFieldSignature(typeClass) {
        var sig = { intCount: 0, shortCount: 0, enumCount: 0, other: 0 };
        try {
            var fs = typeClass.getDeclaredFields();
            for (var i = 0; i < fs.length; i++) {
                if (isStatic(fs[i])) continue;
                var ft = fs[i].getType();
                var ftn = ft.getName();
                if (ftn === 'int') sig.intCount++;
                else if (ftn === 'short') sig.shortCount++;
                else {
                    try {
                        if (ft.isEnum()) { sig.enumCount++; continue; }
                    } catch (_) {}
                    sig.other++;
                }
            }
        } catch (_) {}
        return sig;
    }

    if (pktAbstractClassName) {
        try {
            var pktClass = Java.use(pktAbstractClassName);
            var pktFields = pktClass.class.getDeclaredFields();
            for (var pi = 0; pi < pktFields.length; pi++) {
                var pf = pktFields[pi];
                if (isStatic(pf)) continue;
                pf.setAccessible(true);
                var ft = pf.getType();
                var ftName = ft.getName();
                if (isJavaKotlin(ftName) || ftName.indexOf('[') === 0) continue;

                var sig = inspectFieldSignature(ft);
                // 헤더: int>=2 + short>=1 + enum>=1
                if (!_headerField && sig.intCount >= 2 && sig.shortCount >= 1 && sig.enumCount >= 1) {
                    _headerField = pf;
                    _headerClassName = ftName;
                    continue;
                }
                // 바디: 비-primitive non-static 1개 이상 (BSON/Map)
                if (!_bodyField && sig.other >= 1) {
                    _bodyField = pf;
                    _bodyClassName = ftName;
                }
            }
        } catch (e) {
            emitLog(TAG, 'debug', 'AbstractLocoPacket 필드 스캔 실패: ' + e.message);
        }
    }

    // Body 안의 BSON 필드 (첫 non-static non-primitive)
    if (_bodyClassName) {
        try {
            var bodyClass = Java.use(_bodyClassName);
            var bodyFields = bodyClass.class.getDeclaredFields();
            for (var bi = 0; bi < bodyFields.length; bi++) {
                var bf = bodyFields[bi];
                if (isStatic(bf)) continue;
                bf.setAccessible(true);
                var bft = bf.getType().getName();
                if (bft === 'int' || bft === 'long' || bft === 'short' || bft === 'byte' ||
                    bft === 'float' || bft === 'double' || bft === 'boolean') continue;
                _bsonField = bf;
                break;
            }
        } catch (e) {
            emitLog(TAG, 'debug', 'LocoBody 필드 스캔 실패: ' + e.message);
        }
    }

    emitLog(TAG, 'debug',
        'discovered pkt=' + pktAbstractClassName +
        ' header=' + _headerClassName +
        ' body=' + _bodyClassName +
        ' bson=' + (_bsonField ? 'ok' : 'null')
    );

    // ==============================================================
    // 메서드 이름 (LocoMethod enum) 조회
    // ==============================================================
    function getMethodName(job) {
        if (!hMethod) return '?';
        try {
            var ev = hMethod.invoke(job);
            if (ev) {
                var n = enumName(ev);
                if (n) return n;
            }
        } catch (_) {}
        return '?';
    }

    // ==============================================================
    // Java → JS 변환
    // ==============================================================
    function javaToJs(obj, depth) {
        if (obj == null) return null;
        if (depth > 6) { try { return String(obj); } catch (_) { return '(deep)'; } }
        var t = typeof obj;
        if (t === 'number' || t === 'boolean' || t === 'string') return obj;

        var cls;
        try { cls = obj.getClass().getName(); } catch (_) { try { return String(obj); } catch (_2) { return '(?)'; } }

        if (cls === 'java.lang.Boolean') return toBool(obj);
        if (cls === 'java.lang.Integer' || cls === 'java.lang.Short' || cls === 'java.lang.Byte') return unboxInt(obj);
        if (cls === 'java.lang.Long') {
            var lv = unboxLong(obj);
            return (lv > 9007199254740991 || lv < -9007199254740991) ? String(obj) : lv;
        }
        if (cls === 'java.lang.Double' || cls === 'java.lang.Float') {
            try { return parseFloat(String(obj)); } catch (_) { return 0; }
        }
        if (cls === 'java.lang.String') return String(obj);

        if (cls === '[B') {
            try {
                var len = obj.length;
                var hex = [];
                for (var bi = 0; bi < Math.min(len, 64); bi++) {
                    var b = obj[bi] & 0xFF;
                    hex.push((b < 16 ? '0' : '') + b.toString(16));
                }
                return '<bytes[' + len + ']> ' + hex.join(' ') + (len > 64 ? '...' : '');
            } catch (_) { return '<bytes>'; }
        }

        if (cls === 'java.util.Date') {
            try {
                var getTime = Java.use('java.util.Date').class.getMethod('getTime');
                return Number(getTime.invoke(obj));
            } catch (_) { return String(obj); }
        }

        if (isMap(obj)) {
            var mapResult = iterateMap(obj, depth);
            if (mapResult !== null) return mapResult;
        }

        if (isList(obj)) {
            var listResult = iterateList(obj, depth);
            if (listResult !== null) return listResult;
        }

        try { return String(obj); } catch (_) { return '(obj)'; }
    }

    function iterateMap(javaMap, depth) {
        if (!isMap(javaMap)) return null;
        var result = {};
        try {
            var map = Java.cast(javaMap, _JavaMap);
            var entrySet = map.entrySet();
            var iter = Java.cast(entrySet.iterator(), _JavaIterator);
            var cnt = 0;
            while (iter.hasNext() && cnt < 200) {
                cnt++;
                var entry = Java.cast(iter.next(), _JavaMapEntry);
                var key = String(entry.getKey());
                result[key] = javaToJs(entry.getValue(), depth + 1);
            }
            return result;
        } catch (_) {}
        return null;
    }

    function iterateList(javaList, depth) {
        try {
            var list = Java.cast(javaList, _JavaList);
            var sz = list.size();
            var arr = [];
            for (var i = 0; i < Math.min(sz, 100); i++) {
                arr.push(javaToJs(list.get(i), depth + 1));
            }
            if (sz > 100) arr.push('...(+' + (sz - 100) + ')');
            return arr;
        } catch (_) {}
        return null;
    }

    // ==============================================================
    // 패킷 추출 (discovery 기반)
    // ==============================================================
    function extractPacket(rawPkt) {
        if (!rawPkt) return null;
        try {
            var header = null, body = null, bsonObj = null;

            // Primary: discovered 필드 직접 접근
            if (_headerField) {
                try { header = _headerField.get(rawPkt); } catch (_) {}
            }
            if (_bodyField) {
                try {
                    body = _bodyField.get(rawPkt);
                    if (body && _bsonField) {
                        try { bsonObj = _bsonField.get(body); } catch (_) {}
                    }
                } catch (_) {}
            }

            // Fallback: 구조 기반 필드 탐색 (discovery 실패 시)
            if (!header || !body) {
                var cur = rawPkt.getClass();
                for (var d = 0; d < 6 && cur; d++) {
                    try {
                        var fs = cur.getDeclaredFields();
                        for (var i = 0; i < fs.length; i++) {
                            if (isStatic(fs[i])) continue;
                            fs[i].setAccessible(true);
                            var val;
                            try { val = fs[i].get(rawPkt); } catch (_) { continue; }
                            if (!val) continue;

                            if (!header) {
                                var sig = inspectFieldSignature(val.getClass());
                                if (sig.intCount >= 2 && sig.shortCount >= 1 && sig.enumCount >= 1) {
                                    header = val;
                                    continue;
                                }
                            }
                            if (!body) {
                                if (isMap(val)) { bsonObj = val; body = val; }
                                else {
                                    try {
                                        var bf = val.getClass().getDeclaredFields();
                                        for (var bi = 0; bi < bf.length; bi++) {
                                            if (isStatic(bf[bi])) continue;
                                            bf[bi].setAccessible(true);
                                            var bfv;
                                            try { bfv = bf[bi].get(val); } catch (_) { continue; }
                                            if (bfv && isMap(bfv)) { body = val; bsonObj = bfv; break; }
                                        }
                                    } catch (_) {}
                                }
                            }
                        }
                    } catch (_) {}
                    try { cur = cur.getSuperclass(); } catch (_) { break; }
                }
            }

            // 헤더 파싱
            var pid = -1, st = -1, meth = '?', blen = -1;
            if (header) {
                try {
                    var hfs = header.getClass().getDeclaredFields();
                    var ints = [];
                    for (var hi = 0; hi < hfs.length; hi++) {
                        if (isStatic(hfs[hi])) continue;
                        hfs[hi].setAccessible(true);
                        var hft = hfs[hi].getType();
                        var hftn = hft.getName();
                        var hv;
                        try { hv = hfs[hi].get(header); } catch (_) { continue; }
                        if (hftn === 'int') ints.push(unboxInt(hv));
                        else if (hftn === 'short') st = unboxInt(hv);
                        else {
                            var isEnumType = false;
                            try { isEnumType = hft.isEnum(); } catch (_) {}
                            if (isEnumType && hv) {
                                var en = enumName(hv);
                                if (en) meth = en;
                            }
                        }
                    }
                    if (ints.length >= 2) { pid = ints[0]; blen = ints[1]; }
                    else if (ints.length === 1) { pid = ints[0]; }
                } catch (_) {}
            }

            // 바디 → BSON → JS
            var bodyObj = null;
            if (bsonObj && isMap(bsonObj)) {
                bodyObj = iterateMap(bsonObj, 0);
            } else if (body) {
                if (isMap(body)) {
                    bodyObj = iterateMap(body, 0);
                } else {
                    // body에서 Map 필드 재탐색
                    try {
                        var bfs = body.getClass().getDeclaredFields();
                        for (var bi = 0; bi < bfs.length; bi++) {
                            if (isStatic(bfs[bi])) continue;
                            bfs[bi].setAccessible(true);
                            var bv;
                            try { bv = bfs[bi].get(body); } catch (_) { continue; }
                            if (bv && isMap(bv)) {
                                bodyObj = iterateMap(bv, 0);
                                if (bodyObj !== null) break;
                            }
                        }
                    } catch (_) {}
                }
            }

            return { header: { packetId: pid, status: st, method: meth, bodyLength: blen }, body: bodyObj };
        } catch (e) {
            emitLog(TAG, 'warn', 'extractPacket err: ' + e.message);
            return { header: {}, body: null };
        }
    }

    // ==============================================================
    // 패킷 emit
    // ==============================================================
    function emitPacket(event, job, pkt) {
        var methodName = '?';
        try { methodName = getMethodName(job); } catch (_) {}

        var pktInfo = null;
        try { pktInfo = extractPacket(pkt); } catch (_) {}
        var hdr = pktInfo ? pktInfo.header : {};

        if (methodName === '?' && hdr.method && hdr.method !== '?') methodName = hdr.method;

        // 메서드도 바디도 없으면 노이즈
        if (methodName === '?' && (!pktInfo || !pktInfo.body)) return;

        send({
            type: 'loco', event: event,
            method: methodName,
            packetId: hdr.packetId != null ? hdr.packetId : -1,
            status: hdr.status != null ? hdr.status : -1,
            bodyLength: hdr.bodyLength != null ? hdr.bodyLength : -1,
            body: pktInfo ? pktInfo.body : null,
        });
    }

    // ==============================================================
    // Hook: LocoJob.f(req, cont) → 송신
    // ==============================================================
    var fHooked = false;
    if (fOverloadParams) {
        try {
            var fOverload = LocoJobClass.f.overload(fOverloadParams[0], fOverloadParams[1]);
            fOverload.implementation = function (req, cont) {
                try {
                    var isResume = false;
                    try {
                        if (cont && cont.getClass) {
                            var cc = cont.getClass().getName();
                            isResume = cc.indexOf('LocoJob') >= 0 && cc.indexOf('$') >= 0;
                        }
                    } catch (_) {}
                    if (!isResume) emitPacket('send', this, req);
                } catch (e) {
                    emitLog(TAG, 'warn', 'send err: ' + e.message);
                }
                return fOverload.call(this, req, cont);
            };
            hookCount++;
            fHooked = true;
            emitLog(TAG, 'info', 'LocoJob.f 송신 후킹 성공');
        } catch (e) {
            emitLog(TAG, 'warn', 'LocoJob.f 후킹 실패: ' + e.message);
        }
    }

    // ==============================================================
    // Hook: LocoJob.v(res) → 수신 (primary)
    // ==============================================================
    var vHooked = false;
    if (vOverloadParam) {
        try {
            var vOverload = LocoJobClass.v.overload(vOverloadParam);
            vOverload.implementation = function (resp) {
                try { emitPacket('recv', this, resp); }
                catch (e) { emitLog(TAG, 'warn', 'recv err: ' + e.message); }
                return vOverload.call(this, resp);
            };
            hookCount++;
            vHooked = true;
            emitLog(TAG, 'info', 'LocoJob.v 수신 후킹 성공');
        } catch (e) {
            emitLog(TAG, 'warn', 'LocoJob.v 후킹 실패: ' + e.message);
        }
    }

    // ==============================================================
    // Hook: LocoJob.n(res, Function1) → 수신 (v 실패 시 fallback)
    // ==============================================================
    if (!vHooked && nOverloadParams) {
        try {
            var nOverload = LocoJobClass.n.overload(nOverloadParams[0], nOverloadParams[1]);
            nOverload.implementation = function (resp, hookFn) {
                try { emitPacket('recv', this, resp); }
                catch (e) { emitLog(TAG, 'warn', 'recv/n err: ' + e.message); }
                return nOverload.call(this, resp, hookFn);
            };
            hookCount++;
            emitLog(TAG, 'info', 'LocoJob.n 수신 후킹 성공 (fallback)');
        } catch (e) {
            emitLog(TAG, 'warn', 'LocoJob.n 후킹 실패: ' + e.message);
        }
    }

    if (!fHooked && !vHooked) {
        emitLog(TAG, 'warn', '송/수신 후킹 모두 실패');
    }

    // ==============================================================
    // Hook: Socket.connect → LOCO 서버 연결 감지
    // ==============================================================
    try {
        var Socket = Java.use('java.net.Socket');
        Socket.connect.overload('java.net.SocketAddress', 'int').implementation = function (addr, timeout) {
            this.connect(addr, timeout);
            try {
                var s = addr ? addr.toString() : '';
                if (s.indexOf('kakao') >= 0) {
                    send({ type: 'loco', event: 'socket_connect', host: s, timeout: timeout });
                }
            } catch (_) {}
        };
        hookCount++;
    } catch (_) {}

    if (hookCount > 0) {
        _locoInstalled = true;
        emitLog(TAG, 'info', 'LOCO 모니터 설치 완료 (' + hookCount + '개 훅)');
    } else {
        emitLog(TAG, 'error', 'LOCO 모니터: 후킹 없음');
    }
}
