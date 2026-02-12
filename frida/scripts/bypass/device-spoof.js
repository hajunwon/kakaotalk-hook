// device-spoof.js - 디바이스 정보 위장
// Build.*, Settings.Secure, TelephonyManager 등 스푸핑
// DEVICE_PROFILE은 script-manager.js에서 .env 값으로 주입됨

function installDeviceSpoof() {
    _spoofBuildFields();
    _spoofSettingsSecure();
    _spoofTelephony();
    emitLog('device-spoof', 'info', `${DEVICE_PROFILE.MODEL} (${DEVICE_PROFILE.MANUFACTURER}) 위장 완료`);
}

// android.os.Build 정적 필드 변경
function _spoofBuildFields() {
    try {
        const Build = Java.use('android.os.Build');
        const fields = {
            MODEL: DEVICE_PROFILE.MODEL,
            MANUFACTURER: DEVICE_PROFILE.MANUFACTURER,
            BRAND: DEVICE_PROFILE.BRAND,
            DEVICE: DEVICE_PROFILE.DEVICE,
            PRODUCT: DEVICE_PROFILE.PRODUCT,
            HARDWARE: DEVICE_PROFILE.HARDWARE,
            BOARD: DEVICE_PROFILE.BOARD,
            FINGERPRINT: DEVICE_PROFILE.FINGERPRINT,
            DISPLAY: DEVICE_PROFILE.DISPLAY,
        };

        for (const [key, val] of Object.entries(fields)) {
            try {
                const field = Build.class.getDeclaredField(key);
                field.setAccessible(true);
                field.set(null, Java.use('java.lang.String').$new(val));
            } catch (_) {}
        }
    } catch (_) {}
}

// Settings.Secure.getString → ANDROID_ID 스푸핑
function _spoofSettingsSecure() {
    if (!DEVICE_PROFILE.ANDROID_ID) return;
    try {
        const Secure = Java.use('android.provider.Settings$Secure');
        Secure.getString.implementation = function (resolver, name) {
            if (name === 'android_id') return DEVICE_PROFILE.ANDROID_ID;
            return this.getString(resolver, name);
        };
    } catch (_) {}
}

// TelephonyManager 스푸핑 (IMEI 등은 빈 문자열 반환)
function _spoofTelephony() {
    try {
        const TM = Java.use('android.telephony.TelephonyManager');

        // getDeviceId → 빈 값 (에뮬레이터 탐지 우회)
        try {
            TM.getDeviceId.overload().implementation = function () {
                return '000000000000000';
            };
            TM.getDeviceId.overload('int').implementation = function (slot) {
                return '000000000000000';
            };
        } catch (_) {}

        // getSubscriberId
        try {
            TM.getSubscriberId.overload().implementation = function () {
                return DEVICE_PROFILE.MCC_MNC + '1234567890';
            };
        } catch (_) {}

        // getSimOperatorName
        try {
            TM.getSimOperatorName.implementation = function () {
                return DEVICE_PROFILE.CARRIER;
            };
        } catch (_) {}

        // getNetworkOperatorName
        try {
            TM.getNetworkOperatorName.implementation = function () {
                return DEVICE_PROFILE.CARRIER;
            };
        } catch (_) {}

        // getNetworkOperator (MCC+MNC)
        try {
            TM.getNetworkOperator.implementation = function () {
                return DEVICE_PROFILE.MCC_MNC;
            };
        } catch (_) {}

        // getSimOperator
        try {
            TM.getSimOperator.implementation = function () {
                return DEVICE_PROFILE.MCC_MNC;
            };
        } catch (_) {}

        // getPhoneType
        try {
            TM.getPhoneType.implementation = function () {
                return 1; // PHONE_TYPE_GSM
            };
        } catch (_) {}
    } catch (_) {}
}
