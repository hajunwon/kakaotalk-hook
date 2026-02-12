// nfilter.js - NSHC NFilter 보안 모듈 우회 (런타임 탐색)
// 앱 classloader 세팅 후 호출

function installNFilterBypass() {
    let count = 0;
    try {
        Java.enumerateLoadedClasses({
            onMatch(name) {
                if (!name.includes('nshc') || !name.includes('nfilter')) return;
                try {
                    const cls = Java.use(name);
                    const methods = cls.class.getDeclaredMethods();
                    for (let i = 0; i < methods.length; i++) {
                        const m = methods[i];
                        if (m.getReturnType().getName() === 'void' && m.getParameterTypes().length === 0) {
                            try {
                                const mName = m.getName();
                                cls[mName].overload().implementation = function () {
                                    emitLog('nfilter', 'warn', `${name}.${mName}() 차단`);
                                };
                                count++;
                            } catch (_) {}
                        }
                    }
                } catch (_) {}
            },
            onComplete() {}
        });
    } catch (_) {}
    emitLog('nfilter', 'info', `${count}개 메서드 무력화 완료`);
}
