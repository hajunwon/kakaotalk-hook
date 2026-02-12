// sharedpref.js - SharedPreferences 읽기 감시 (token/auth/key)

function installSharedPrefHooks() {
    try {
        const SP = Java.use('android.app.SharedPreferencesImpl');
        SP.getString.implementation = function (key, def) {
            const val = this.getString(key, def);
            if (key && (key.includes('token') || key.includes('auth') || key.includes('key'))) {
                emitEvent('sharedpref', {
                    type: 'sharedpref',
                    key,
                    value: val ? val.substring(0, 32) + '...' : null,
                }, 'info');
            }
            return val;
        };
        emitLog('sharedpref', 'info', 'getString 감시 완료');
    } catch (_) {}
}
