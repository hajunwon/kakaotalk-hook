// kakaotalk-app.js - 카카오톡 앱 전용 hook (앱 classloader 필요)
// 26.1.2 기준 최적화

function installKakaoTalkAppHooks() {
    try {
        const Splash = Java.use('com.kakao.talk.activity.SplashActivity');
        Splash.onCreate.overload('android.os.Bundle').implementation = function (b) {
            emitLog('kakaotalk-app', 'info', 'SplashActivity.onCreate');
            return this.onCreate(b);
        };
    } catch (e) {
        emitLog('kakaotalk-app', 'warn', `SplashActivity 실패: ${e.message}`);
    }

    try {
        const App = Java.use('com.kakao.talk.application.App');
        App.attachBaseContext.implementation = function (ctx) {
            emitLog('kakaotalk-app', 'info', 'App.attachBaseContext');
            return this.attachBaseContext(ctx);
        };
    } catch (e) {
        emitLog('kakaotalk-app', 'warn', `App 실패: ${e.message}`);
    }
}
