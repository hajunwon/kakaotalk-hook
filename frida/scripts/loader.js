// loader.js - 메인 진입점
// script-manager가 각 모듈을 concat → install* 함수 사용 가능

'use strict';

// 1. 네이티브 bypass (Java 불필요, 즉시)
if (isScriptEnabled('anti-detect')) {
    installAntiDetect();
}

// 2. Java VM 대기 → 단계별 hook 설치
let _clFound = false;

function _findAppCL() {
    if (_clFound) return;
    try {
        Java.enumerateClassLoaders({
            onMatch(loader) {
                try {
                    loader.loadClass('com.kakao.talk.application.App');
                    Java.classFactory.loader = loader;
                    _clFound = true;
                    emitLog('kakaotalk-app', 'info', '[+] 앱 ClassLoader 발견');

                    // 앱 classloader 필요한 hook
                    if (isScriptEnabled('nfilter')) {
                        installNFilterBypass();
                    }
                    if (isScriptEnabled('kakaotalk-app')) {
                        installKakaoTalkAppHooks();
                    }
                    if (isScriptEnabled('loco-monitor')) {
                        installLocoMonitor();
                    }
                    if (isScriptEnabled('http-monitor')) {
                        installHttpMonitor();
                    }
                } catch (_) {}
            },
            onComplete() {
                if (!_clFound) setTimeout(() => Java.perform(_findAppCL), 500);
            }
        });
    } catch (_) {
        setTimeout(() => Java.perform(_findAppCL), 500);
    }
}

function _waitJava() {
    if (!Java.available) { setTimeout(_waitJava, 100); return; }

    Java.perform(() => {
        emitLog('anti-kill', 'info', '[+] Java VM ready');

        // 기본 classloader hook
        if (isScriptEnabled('anti-kill')) {
            installAntiKill();
        }
        if (isScriptEnabled('device-spoof')) {
            installDeviceSpoof();
        }
        if (isScriptEnabled('activity')) {
            installActivityHooks();
        }
        if (isScriptEnabled('sharedpref')) {
            installSharedPrefHooks();
        }

        // 앱 classloader 탐색 → 앱 전용 hook
        _findAppCL();
    });
}

setTimeout(_waitJava, 0);
