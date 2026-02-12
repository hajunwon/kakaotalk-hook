// anti-kill.js - 프로세스 종료 차단 (Java + Native)

function installAntiKill() {
    // Process.killProcess(myPid) 차단
    try {
        const Proc = Java.use('android.os.Process');
        Proc.killProcess.implementation = function (pid) {
            if (pid === Proc.myPid()) {
                emitLog('anti-kill', 'warn', `killProcess(${pid}) 차단`);
                return;
            }
            return this.killProcess(pid);
        };
    } catch (_) {}

    // System.exit / Runtime.exit 차단
    try {
        const Sys = Java.use('java.lang.System');
        Sys.exit.implementation = function (code) {
            emitLog('anti-kill', 'warn', `System.exit(${code}) 차단`);
        };
    } catch (_) {}

    try {
        const RT = Java.use('java.lang.Runtime');
        RT.exit.implementation = function (code) {
            emitLog('anti-kill', 'warn', `Runtime.exit(${code}) 차단`);
        };
    } catch (_) {}

    // native kill(SIGKILL/SIGTERM → self) 차단
    try {
        const ptr_kill = Module.findExportByName(null, 'kill');
        if (ptr_kill) {
            Interceptor.attach(ptr_kill, {
                onEnter(args) {
                    this.block = false;
                    const pid = args[0].toInt32();
                    const sig = args[1].toInt32();
                    if (pid === Process.id && (sig === 9 || sig === 15)) {
                        this.block = true;
                        args[0] = ptr(-1);
                    }
                },
                onLeave(retval) {
                    if (this.block) retval.replace(ptr(0));
                }
            });
        }
    } catch (_) {}

    emitLog('anti-kill', 'info', 'killProcess / exit / kill() 차단 완료');
}
