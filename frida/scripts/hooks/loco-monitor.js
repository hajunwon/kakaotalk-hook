// loco-monitor.js - LOCO 프로토콜 패킷 모니터링 (순수 Java reflection 버전)
//
// R8 난독화로 필드/메서드 이름이 전부 충돌 (a~h)
// → Frida wrapper의 .method() 호출 전부 불가
// → 해결: 모든 호출을 java.lang.reflect.Method.invoke()로 수행

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

    var _intValueMethod = null, _longValueMethod = null, _shortValueMethod = null;
    try { _intValueMethod = Java.use('java.lang.Number').class.getMethod('intValue'); } catch (_) {}
    try { _longValueMethod = Java.use('java.lang.Number').class.getMethod('longValue'); } catch (_) {}
    try { _shortValueMethod = Java.use('java.lang.Number').class.getMethod('shortValue'); } catch (_) {}

    var _booleanValueMethod = null;
    try { _booleanValueMethod = Java.use('java.lang.Boolean').class.getMethod('booleanValue'); } catch (_) {}

    var _Modifier = null;
    try { _Modifier = Java.use('java.lang.reflect.Modifier'); } catch (_) {}

    function isStaticField(f) {
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

    function toBool(javaObj) {
        if (typeof javaObj === 'boolean') return javaObj;
        if (javaObj == null) return false;
        try { if (_booleanValueMethod) return !!_booleanValueMethod.invoke(javaObj); } catch (_) {}
        try { return String(javaObj) === 'true'; } catch (_) {}
        return false;
    }

    // ==============================================================
    // reflection 메서드 찾기 (캐시)
    // ==============================================================
    var _reflCache = {};

    function findMethod0(obj, name, retHint) {
        var cls = obj.getClass();
        var key = cls.getName() + ':' + name + ':' + (retHint || '');
        if (_reflCache[key] !== undefined) return _reflCache[key];

        // getDeclaredMethods 계층 탐색
        var cur = cls;
        for (var d = 0; d < 8 && cur; d++) {
            try {
                var ms = cur.getDeclaredMethods();
                for (var i = 0; i < ms.length; i++) {
                    if (ms[i].getName() === name && ms[i].getParameterTypes().length === 0) {
                        if (!retHint || ms[i].getReturnType().getName().indexOf(retHint) >= 0) {
                            ms[i].setAccessible(true);
                            _reflCache[key] = ms[i];
                            return ms[i];
                        }
                    }
                }
            } catch (_) {}
            try { cur = cur.getSuperclass(); } catch (_) { break; }
        }
        // getMethods (public, interface 포함)
        try {
            var pms = cls.getMethods();
            for (var j = 0; j < pms.length; j++) {
                if (pms[j].getName() === name && pms[j].getParameterTypes().length === 0) {
                    if (!retHint || pms[j].getReturnType().getName().indexOf(retHint) >= 0) {
                        _reflCache[key] = pms[j];
                        return pms[j];
                    }
                }
            }
        } catch (_) {}

        _reflCache[key] = null;
        return null;
    }

    function invoke0(obj, name, retHint) {
        if (!obj) return undefined;
        try { var m = findMethod0(obj, name, retHint); if (m) return m.invoke(obj); } catch (_) {}
        return undefined;
    }

    // get(String) 또는 get(Object) 메서드 캐시
    var _getMethodCache = {};
    function findGetMethod(obj) {
        var cn = obj.getClass().getName();
        if (_getMethodCache[cn] !== undefined) return _getMethodCache[cn];
        var found = null;
        try {
            var ms = obj.getClass().getMethods();
            for (var i = 0; i < ms.length; i++) {
                if (ms[i].getName() === 'get') {
                    var pt = ms[i].getParameterTypes();
                    if (pt.length === 1) {
                        var ptn = pt[0].getName();
                        if (ptn === 'java.lang.String') { found = ms[i]; break; }
                        if (ptn === 'java.lang.Object' && !found) found = ms[i];
                    }
                }
            }
        } catch (_) {}
        _getMethodCache[cn] = found;
        return found;
    }

    // ==============================================================
    // LocoJob.h() 메서드 (LocoMethod enum) — 미리 찾기
    // ==============================================================
    var _hMethod = null;
    try {
        var ljMs = LocoJobClass.class.getDeclaredMethods();
        for (var mi = 0; mi < ljMs.length; mi++) {
            var mm = ljMs[mi];
            if (mm.getName() === 'h' && mm.getParameterTypes().length === 0) {
                var rt = mm.getReturnType().getName();
                var skip = (rt === 'int' || rt === 'short' || rt === 'void' || rt === 'boolean' ||
                    rt === 'long' || rt === 'byte' || rt.indexOf('java.') === 0 || rt.indexOf('kotlin.') === 0);
                if (!skip) {
                    mm.setAccessible(true);
                    _hMethod = mm;
                    emitLog(TAG, 'debug', 'h() ret=' + rt);
                    break;
                }
            }
        }
    } catch (_) {}

    function getMethodName(job) {
        if (!_hMethod) return '?';
        try { var ev = _hMethod.invoke(job); if (ev) { var n = enumName(ev); if (n) return n; } } catch (_) {}
        return '?';
    }

    // ==============================================================
    // iterateMap — Java Map/BSON → JS 객체
    // Java.cast로 java.util.Map 인터페이스 사용 (R8 충돌 회피)
    // ==============================================================
    var _JavaMap = null, _JavaIterator = null, _JavaMapEntry = null, _JavaSet = null;
    try { _JavaMap = Java.use('java.util.Map'); } catch (_) {}
    try { _JavaIterator = Java.use('java.util.Iterator'); } catch (_) {}
    try { _JavaMapEntry = Java.use('java.util.Map$Entry'); } catch (_) {}
    try { _JavaSet = Java.use('java.util.Set'); } catch (_) {}

    function isMap(obj) {
        if (!_JavaMap) return false;
        try { return _JavaMap.class.isInstance(obj); } catch (_) { return false; }
    }

    function isList(obj) {
        try { return Java.use('java.util.List').class.isInstance(obj); } catch (_) { return false; }
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
        } catch (e) {
            emitLog(TAG, 'debug', 'iterateMap err: ' + e.message);
        }
        return null;
    }

    function iterateList(javaList, depth) {
        try {
            var list = Java.cast(javaList, Java.use('java.util.List'));
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
    // javaToJs — Java 객체 → JS 객체 (재귀)
    // ==============================================================
    function javaToJs(obj, depth) {
        if (obj == null || obj === undefined) return null;
        if (depth > 6) { try { return String(obj); } catch (_) { return '(deep)'; } }
        var t = typeof obj;
        if (t === 'number' || t === 'boolean' || t === 'string') return obj;

        var cls;
        try { cls = obj.getClass().getName(); } catch (_) { try { return String(obj); } catch (_2) { return '(?)'; } }

        // Java primitives
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

        // byte[]
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

        // Date
        if (cls === 'java.util.Date') {
            try { return Number(invoke0(obj, 'getTime')); } catch (_) { return String(obj); }
        }

        // Map/BSON (LinkedHashMap, BasicBSONObject 등)
        if (isMap(obj)) {
            var mapResult = iterateMap(obj, depth);
            if (mapResult !== null) return mapResult;
        }

        // List/Array
        if (isList(obj)) {
            var listResult = iterateList(obj, depth);
            if (listResult !== null) return listResult;
        }

        // fallback: toString
        try { return String(obj); } catch (_) { return '(obj)'; }
    }

    // ==============================================================
    // extractBody — LocoBody에서 BSON 추출 → JS 변환
    // ==============================================================
    function extractBody(body) {
        if (!body) return null;

        var bodyCls = '';
        try { bodyCls = body.getClass().getName(); } catch (_) {}
        emitLog(TAG, 'debug', 'extractBody cls=' + bodyCls);

        // body 자체가 Map이면 바로
        if (isMap(body)) {
            var r0 = iterateMap(body, 0);
            if (r0 !== null) return r0;
        }

        // LocoBody 내부 필드에서 BSON 찾기
        try {
            var bfs = body.getClass().getDeclaredFields();
            for (var bi = 0; bi < bfs.length; bi++) {
                if (isStaticField(bfs[bi])) continue;
                bfs[bi].setAccessible(true);
                var bv;
                try { bv = bfs[bi].get(body); } catch (_) { continue; }
                if (!bv) continue;

                if (isMap(bv)) {
                    var r = iterateMap(bv, 0);
                    if (r !== null && Object.keys(r).length > 0) return r;
                }

                // toMap() fallback
                var tm = invoke0(bv, 'toMap');
                if (tm && isMap(tm)) {
                    var r2 = iterateMap(tm, 0);
                    if (r2 !== null && Object.keys(r2).length > 0) return r2;
                }
            }
        } catch (e) {
            emitLog(TAG, 'debug', 'extractBody field err: ' + e.message);
        }

        // toString fallback
        try { return String(body); } catch (_) { return null; }
    }

    // ==============================================================
    // extractPacket — 패킷에서 header/body 추출
    //
    // JADX 분석 결과:
    //   lq.f (AbstractLocoPacket):
    //     field a → lq.b (LocoHeader): packetId(int), status(short), method(lq.d enum), bodyLength(int)
    //     field b → lq.a (LocoBody): field a → Ux0.g (BSONObject, 실제 BasicBSONObject = LinkedHashMap)
    //   lq.k (LocoReq), lq.l (LocoRes) → extends lq.f
    //   getter: e() → LocoHeader, c() → LocoBody
    //   LocoBody getter: a() → BSONObject (Ux0.g)
    //   BSONObject.toMap() → java.util.Map
    //   BasicBSONObject (Ux0.k) extends LinkedHashMap → 자체가 Map
    // ==============================================================

    // AbstractLocoPacket 클래스 캐시
    var _AbstractLocoPacket = null;
    try { _AbstractLocoPacket = Java.use('lq.f'); } catch (_) {}

    // getter 메서드 캐시 (reflection)
    var _pktGetHeader = null, _pktGetBody = null, _bodyGetBson = null;
    var _pktGettersInited = false;

    function initPacketGetters() {
        if (_pktGettersInited) return;
        _pktGettersInited = true;

        // lq.f 필드 직접 접근 (가장 확실한 방법)
        // field a → lq.b (LocoHeader), field b → lq.a (LocoBody)
        try {
            var lqf = Java.use('lq.f').class;
            var fs = lqf.getDeclaredFields();
            for (var fi = 0; fi < fs.length; fi++) {
                if (isStaticField(fs[fi])) continue;
                fs[fi].setAccessible(true);
                var ftn = fs[fi].getType().getName();
                // LocoHeader = lq.b (int, short, enum, int 필드)
                if (ftn === 'lq.b' && !_pktGetHeader) _pktGetHeader = fs[fi];
                // LocoBody = lq.a
                if (ftn === 'lq.a' && !_pktGetBody) _pktGetBody = fs[fi];
            }
            emitLog(TAG, 'debug', 'pkt fields: getHeader=' + !!_pktGetHeader + ' getBody=' + !!_pktGetBody);
        } catch (_) {
            // lq.f는 빌드마다 이름이 다를 수 있음 — 무시하고 fallback 사용
        }

        // LocoBody → field a (Ux0.g BSONObject)
        try {
            var lqa = Java.use('lq.a').class;
            var bfs = lqa.getDeclaredFields();
            for (var bi = 0; bi < bfs.length; bi++) {
                if (isStaticField(bfs[bi])) continue;
                bfs[bi].setAccessible(true);
                _bodyGetBson = bfs[bi]; // 첫 번째 non-static 필드 = bson
                break;
            }
            emitLog(TAG, 'debug', 'bodyGetBson=' + !!_bodyGetBson + (_bodyGetBson ? ' fieldType=' + _bodyGetBson.getType().getName() : ''));
        } catch (_) {
            // lq.a도 빌드마다 이름이 다를 수 있음 — 무시하고 fallback 사용
        }
    }

    function extractPacket(rawPkt) {
        if (!rawPkt) return null;
        try {
            initPacketGetters();

            var header = null, body = null, bsonObj = null;
            var pktCls = '';
            try { pktCls = rawPkt.getClass().getName(); } catch (_) {}

            // ======= 방법 1: 필드 직접 접근 (lq.f.a=header, lq.f.b=body) =======
            if (_pktGetHeader) {
                try { header = _pktGetHeader.get(rawPkt); } catch (_) {}
            }
            if (_pktGetBody) {
                try {
                    var locoBody = _pktGetBody.get(rawPkt);
                    if (locoBody) {
                        body = locoBody;
                        // LocoBody field a → BSONObject
                        if (_bodyGetBson) {
                            try { bsonObj = _bodyGetBson.get(locoBody); } catch (_) {}
                        }
                    }
                } catch (_) {}
            }

            // ======= 방법 2: 필드 탐색 fallback =======
            if (!header || !body) {
                var cur = rawPkt.getClass();
                for (var d = 0; d < 6 && cur; d++) {
                    try {
                        var fs = cur.getDeclaredFields();
                        for (var i = 0; i < fs.length; i++) {
                            if (isStaticField(fs[i])) continue;
                            fs[i].setAccessible(true);
                            var ft = fs[i].getType().getName();
                            var val;
                            try { val = fs[i].get(rawPkt); } catch (_) { continue; }
                            if (!val) continue;

                            // header: int+short 필드를 가진 객체
                            if (!header) {
                                try {
                                    var cf = val.getClass().getDeclaredFields();
                                    var hasInt = false, hasShort = false;
                                    for (var c = 0; c < cf.length; c++) {
                                        if (isStaticField(cf[c])) continue;
                                        var ct = cf[c].getType().getName();
                                        if (ct === 'int') hasInt = true;
                                        if (ct === 'short') hasShort = true;
                                    }
                                    if (hasInt && hasShort) header = val;
                                } catch (_) {}
                            }

                            // body: Map이거나 내부에 Map이 있는 객체
                            if (!body) {
                                if (isMap(val)) { bsonObj = val; body = val; }
                                else {
                                    try {
                                        var bf = val.getClass().getDeclaredFields();
                                        for (var bi = 0; bi < bf.length; bi++) {
                                            if (isStaticField(bf[bi])) continue;
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

            // ======= header 파싱 =======
            var pid = -1, st = -1, meth = '?', blen = -1;
            if (header) {
                try {
                    var hfs = header.getClass().getDeclaredFields();
                    var ints = [];
                    for (var hi = 0; hi < hfs.length; hi++) {
                        if (isStaticField(hfs[hi])) continue;
                        hfs[hi].setAccessible(true);
                        var hft = hfs[hi].getType().getName();
                        var hv;
                        try { hv = hfs[hi].get(header); } catch (_) { continue; }
                        if (hft === 'int') { ints.push(unboxInt(hv)); }
                        else if (hft === 'short') { st = unboxInt(hv); }
                        else {
                            var isPrim = 'int,short,boolean,long,byte,float,double,char'.indexOf(hft) >= 0;
                            if (!isPrim && hft.indexOf('java.') !== 0 && hft.indexOf('kotlin.') !== 0 && hv) {
                                var en = enumName(hv);
                                if (en) meth = en;
                            }
                        }
                    }
                    if (ints.length >= 2) { pid = ints[0]; blen = ints[1]; }
                    else if (ints.length === 1) { pid = ints[0]; }
                } catch (_) {}
            }

            // ======= body → BSON → JS =======
            if (shouldLog(TAG, 'debug')) {
                var hdrCls = '';
                try { hdrCls = header ? header.getClass().getName() : 'null'; } catch (_) {}
                var bdyCls = '';
                try { bdyCls = body ? body.getClass().getName() : 'null'; } catch (_) {}
                var bsonCls = '';
                try { bsonCls = bsonObj ? bsonObj.getClass().getName() : 'null'; } catch (_) {}
                emitLog(TAG, 'debug', 'extractPacket pkt=' + pktCls + ' hdr=' + hdrCls + ' body=' + bdyCls + ' bson=' + bsonCls + ' isMap=' + isMap(bsonObj));
            }

            var bodyObj = null;
            // bsonObj가 이미 추출된 경우 → 직접 변환
            if (bsonObj) {
                if (isMap(bsonObj)) {
                    bodyObj = iterateMap(bsonObj, 0);
                }
                if (!bodyObj) {
                    // toMap() fallback
                    var tm = invoke0(bsonObj, 'toMap');
                    if (tm && isMap(tm)) bodyObj = iterateMap(tm, 0);
                }
                if (!bodyObj) {
                    try { bodyObj = String(bsonObj); } catch (_) {}
                }
            } else if (body) {
                bodyObj = extractBody(body);
            }

            return { header: { packetId: pid, status: st, method: meth, bodyLength: blen }, body: bodyObj };
        } catch (e) {
            emitLog(TAG, 'warn', 'extractPacket err: ' + e.message);
            return { header: {}, body: null, error: e.message };
        }
    }

    // ==============================================================
    // 런타임 메서드 파라미터 타입
    // ==============================================================
    function getParamTypes(cls, name) {
        var results = [];
        try {
            var ms = cls.getDeclaredMethods();
            for (var i = 0; i < ms.length; i++) {
                if (ms[i].getName() === name) {
                    var ps = ms[i].getParameterTypes();
                    var r = [];
                    for (var j = 0; j < ps.length; j++) r.push(ps[j].getName());
                    results.push(r);
                }
            }
        } catch (_) {}
        return results;
    }

    // ==============================================================
    // send/recv 공통 처리
    // ==============================================================
    function emitPacket(event, job, pkt) {
        var methodName = '?';
        try { methodName = getMethodName(job); } catch (_) {}

        var pktInfo = null;
        try { pktInfo = extractPacket(pkt); } catch (_) {}
        var hdr = pktInfo ? pktInfo.header : {};

        // header의 method가 더 정확할 수 있음
        if (methodName === '?' && hdr.method && hdr.method !== '?') methodName = hdr.method;

        // 노이즈 스킵 (method도 없고 body도 없음)
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
    // 1. LocoJob.f(request, continuation) → 송신 hook
    // ==============================================================
    var fHooked = false;
    var fOverloads = getParamTypes(LocoJobClass.class, 'f');
    emitLog(TAG, 'debug', 'f() overloads: ' + fOverloads.length);

    for (var fo = 0; fo < fOverloads.length; fo++) {
        var fpt = fOverloads[fo];
        if (fpt.length === 2) {
            emitLog(TAG, 'debug', 'f() params: ' + fpt.join(','));
            try {
                var fOverload = LocoJobClass.f.overload(fpt[0], fpt[1]);
                fOverload.implementation = function (req, cont) {
                    try {
                        var isResume = false;
                        try {
                            if (cont && cont.getClass) {
                                var cc = cont.getClass().getName();
                                isResume = cc.indexOf('LocoJob') >= 0 && cc.indexOf('$') >= 0;
                            }
                        } catch (_) {}

                        if (!isResume) {
                            emitPacket('send', this, req);
                        }
                    } catch (e) {
                        emitLog(TAG, 'warn', 'send err: ' + e.message);
                    }

                    var ret = fOverload.call(this, req, cont);

                    // resume 후 return 값 캡처
                    try {
                        if (ret != null) {
                            var retCls = '';
                            try { retCls = ret.getClass().getName(); } catch (_) {}
                            // COROUTINE_SUSPENDED marker (iv0.a)나 kotlin 타입은 스킵
                            if (retCls && retCls !== 'iv0.a' && retCls.indexOf('kotlin.') < 0) {
                                var testPkt = extractPacket(ret);
                                if (testPkt && testPkt.header && testPkt.header.packetId > 0) {
                                    emitPacket('recv', this, ret);
                                }
                            }
                        }
                    } catch (_) {}

                    return ret;
                };
                hookCount++;
                fHooked = true;
                emitLog(TAG, 'info', 'LocoJob.f(' + fpt.join(',') + ') 후킹 성공');
                break;
            } catch (e) {
                emitLog(TAG, 'warn', 'LocoJob.f 후킹 실패: ' + e.message);
            }
        }
    }

    if (!fHooked) {
        emitLog(TAG, 'warn', 'LocoJob.f 후킹 불가');
    }

    // ==============================================================
    // 2. LocoJob.v(response) → 수신 hook (status 검증)
    //    a()에서 f() 결과로 response를 받은 뒤 호출됨
    //    public final void v(lq.l)
    // ==============================================================
    var vHooked = false;
    try {
        var vOverload = LocoJobClass.v.overload('lq.l');
        vOverload.implementation = function (resp) {
            try {
                emitPacket('recv', this, resp);
            } catch (e) {
                emitLog(TAG, 'warn', 'recv/v err: ' + e.message);
            }
            return vOverload.call(this, resp);
        };
        hookCount++;
        vHooked = true;
        emitLog(TAG, 'info', 'LocoJob.v(lq.l) 수신 후킹 성공');
    } catch (e) {
        emitLog(TAG, 'debug', 'v(lq.l) 직접 overload 실패: ' + e.message);
        // fallback: 리플렉션으로 파라미터 타입 찾기
        try {
            var vMs = LocoJobClass.class.getDeclaredMethods();
            for (var vi = 0; vi < vMs.length; vi++) {
                if (vMs[vi].getName() === 'v') {
                    var vp = vMs[vi].getParameterTypes();
                    if (vp.length === 1) {
                        var vpn = vp[0].getName();
                        if (vpn !== 'long' && vpn !== 'int' && vpn !== 'boolean' &&
                            vpn.indexOf('java.') !== 0 && vpn.indexOf('kotlin.') !== 0) {
                            emitLog(TAG, 'debug', 'v() fallback param=' + vpn);
                            var vOverload2 = LocoJobClass.v.overload(vpn);
                            vOverload2.implementation = function (resp) {
                                try { emitPacket('recv', this, resp); } catch (e2) { emitLog(TAG, 'warn', 'recv/v: ' + e2.message); }
                                return vOverload2.call(this, resp);
                            };
                            hookCount++;
                            vHooked = true;
                            emitLog(TAG, 'info', 'LocoJob.v(' + vpn + ') 수신 후킹 성공 (fallback)');
                            break;
                        }
                    }
                }
            }
        } catch (e2) {
            emitLog(TAG, 'warn', 'LocoJob.v 후킹 실패: ' + e2.message);
        }
    }

    // ==============================================================
    // 3. LocoJob.n(response, hookFn) → 수신 hook (hook 적용)
    //    a()에서 v()보다 먼저 호출됨
    //    public final lq.l n(lq.l, Function1)
    // ==============================================================
    var nHooked = false;
    try {
        var nOverload = LocoJobClass.n.overload('lq.l', 'kotlin.jvm.functions.Function1');
        nOverload.implementation = function (resp, hookFn) {
            try {
                // v()에서도 로깅하므로 n()은 debug 레벨로만 중복 방지
                // (v가 안 잡히면 n이 primary)
                if (!vHooked) {
                    emitPacket('recv', this, resp);
                }
            } catch (e) {
                emitLog(TAG, 'warn', 'recv/n err: ' + e.message);
            }
            return nOverload.call(this, resp, hookFn);
        };
        hookCount++;
        nHooked = true;
        emitLog(TAG, 'info', 'LocoJob.n(lq.l, Function1) 수신 후킹 성공');
    } catch (e) {
        emitLog(TAG, 'debug', 'n(lq.l, Function1) 직접 overload 실패: ' + e.message);
        // fallback: 리플렉션으로 파라미터 타입 찾기
        try {
            var nMs = LocoJobClass.class.getDeclaredMethods();
            for (var ni = 0; ni < nMs.length; ni++) {
                if (nMs[ni].getName() === 'n') {
                    var nps = nMs[ni].getParameterTypes();
                    if (nps.length === 2) {
                        var np0 = nps[0].getName(), np1 = nps[1].getName();
                        emitLog(TAG, 'debug', 'n() fallback params=' + np0 + ',' + np1);
                        var nOverload2 = LocoJobClass.n.overload(np0, np1);
                        nOverload2.implementation = function (resp, hookFn) {
                            try { if (!vHooked) emitPacket('recv', this, resp); } catch (e2) { emitLog(TAG, 'warn', 'recv/n: ' + e2.message); }
                            return nOverload2.call(this, resp, hookFn);
                        };
                        hookCount++;
                        nHooked = true;
                        emitLog(TAG, 'info', 'LocoJob.n(' + np0 + ',' + np1 + ') 수신 후킹 성공 (fallback)');
                        break;
                    }
                }
            }
        } catch (e2) {
            emitLog(TAG, 'warn', 'LocoJob.n 후킹 실패: ' + e2.message);
        }
    }

    if (!vHooked && !nHooked) {
        emitLog(TAG, 'warn', 'response 후킹 불가 — PUSH 모니터링으로 fallback');
    }

    // ==============================================================
    // 4. Socket.connect → LOCO 소켓
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
        emitLog(TAG, 'info', 'LOCO 모니터 설치 완료 (' + hookCount + '개 후킹)');
    } else {
        emitLog(TAG, 'error', 'LOCO 모니터: 후킹 없음');
    }
}
