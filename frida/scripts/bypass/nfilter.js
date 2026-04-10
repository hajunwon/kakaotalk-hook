// nfilter.js - NSHC NFilter 보안 모듈 우회 (런타임 탐색 + 지연 재시도)
// 앱 classloader 세팅 후 호출

function installNFilterBypass() {
    const TAG = 'nfilter';
    let installed = 0;
    const hookedClasses = {};

    function tryHookClass(name) {
        if (hookedClasses[name]) return 0;
        hookedClasses[name] = true;
        let n = 0;
        try {
            const cls = Java.use(name);
            const methods = cls.class.getDeclaredMethods();
            for (let i = 0; i < methods.length; i++) {
                const m = methods[i];
                if (m.getReturnType().getName() !== 'void') continue;
                if (m.getParameterTypes().length !== 0) continue;
                try {
                    const mName = m.getName();
                    cls[mName].overload().implementation = function () {
                        emitLog(TAG, 'debug', `${name}.${mName}() 차단`);
                    };
                    n++;
                } catch (_) {}
            }
        } catch (_) {}
        return n;
    }

    function scan() {
        let delta = 0;
        try {
            Java.enumerateLoadedClasses({
                onMatch(name) {
                    const lower = name.toLowerCase();
                    if (lower.indexOf('nshc') >= 0 && lower.indexOf('nfilter') >= 0) {
                        delta += tryHookClass(name);
                    }
                },
                onComplete() {}
            });
        } catch (_) {}
        return delta;
    }

    installed += scan();

    if (installed > 0) {
        emitLog(TAG, 'info', `${installed}개 메서드 무력화 완료`);
        return;
    }

    // 1차 스캔 0개 → 지연 재시도 (앱이 아직 모듈 로드 안 했을 수 있음)
    emitLog(TAG, 'debug', '1차 스캔 0개 — 3초 후 재시도');
    setTimeout(function () {
        Java.perform(function () {
            const delta = scan();
            if (delta > 0) {
                installed += delta;
                emitLog(TAG, 'info', `${delta}개 메서드 무력화 완료 (지연 로드)`);
            } else {
                emitLog(TAG, 'warn', '무력화 대상 없음 — 이 빌드엔 NFilter 모듈이 로드되지 않거나 이름 패턴이 바뀜');
            }
        });
    }, 3000);
}
