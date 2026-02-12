// anti-detect.js - frida 탐지 우회 (strstr)

const FRIDA_STRINGS = [
    'frida', 'gadget', 'linjector', 'gmain', 'gum-js-loop',
    'frida-agent', 'frida-server', 're.frida.server',
];

function installAntiDetect() {
    const ptr_strstr = Module.findExportByName(null, 'strstr');
    if (!ptr_strstr) return;

    Interceptor.attach(ptr_strstr, {
        onEnter(args) {
            this.block = false;
            try {
                const needle = args[1].readUtf8String();
                if (needle && FRIDA_STRINGS.some(s => needle.toLowerCase().includes(s))) {
                    this.block = true;
                }
            } catch (_) {}
        },
        onLeave(retval) {
            if (this.block) retval.replace(ptr(0));
        }
    });
    emitLog('anti-detect', 'info', 'strstr 후킹 완료');
}
