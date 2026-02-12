// activity.js - Activity lifecycle 로깅

function installActivityHooks() {
    try {
        const Act = Java.use('android.app.Activity');

        Act.onCreate.overload('android.os.Bundle').implementation = function (b) {
            emitEvent('activity', { type: 'activity', event: 'onCreate', name: this.getClass().getName() }, 'info');
            return this.onCreate(b);
        };

        Act.onResume.implementation = function () {
            emitEvent('activity', { type: 'activity', event: 'onResume', name: this.getClass().getName() }, 'info');
            return this.onResume();
        };

        emitLog('activity', 'info', 'onCreate / onResume 로깅 완료');
    } catch (e) {
        emitLog('activity', 'warn', `hook 실패: ${e.message}`);
    }
}
