// werift's @peculiar/x509 imports this before tsyringe, but a compiled bundle runs tsyringe first and the daemon dies on start.
import 'reflect-metadata';
import { askRunningMachine } from './cli/fatal.ts';
import { portTaken, startMachine } from './cli/start.ts';
import { forgetInheritedSession, parseServerArgs } from './config.ts';
import { errorText } from './error-text.ts';

/*
 * Without a listener Bun prints an uncaught error with a code frame, which in the compiled binary is
 * minified bundle source. A throw at the top level of this module lands here as well.
 */
const fail = (error: unknown): never => {
    console.error(errorText(error));
    process.exit(1);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

/*
 * One binary, several jobs: `ruimte` serves, `ruimte login` puts the machine on an account with a code
 * and `ruimte logout` takes it off, `ruimte status` says how clients reach it, `ruimte service` sets up the
 * background service, `ruimte closed-lid` installs the rule behind keep awake with the lid closed,
 * `ruimte context` is the agent-side CLI. The daemon is imported only when it is needed, so the CLI
 * commands do not pay for loading the terminal emulator.
 */
const arguments_ = process.argv.slice(2);
if (arguments_[0] === 'device-helper') {
    const deviceId = arguments_[1];
    if (!deviceId || arguments_.length !== 2) {
        fail(new Error('Usage: ruimte device-helper <device-id>'));
    }
    const { runDeviceHelper } = await import('./devices/native-helper.ts');
    process.exit(await runDeviceHelper(deviceId));
}

const config = parseServerArgs(arguments_);

if (config.command === 'version') {
    const { VERSION } = await import('./version.ts');
    console.log(VERSION);
    process.exit(0);
}

if (config.command === 'service') {
    const { runService } = await import('./cli/service.ts');
    const { COMPILED } = await import('./version.ts');
    process.exit(await runService(config.args, { port: config.port, ruimteHome: config.home, compiled: COMPILED }));
}

// todo(bas): drop the command one release after pairing links went.
if (config.command === 'pair') {
    console.error('Pairing links are gone. Run `ruimte login` to put this machine on your account.');
    process.exit(1);
}

if (config.command === 'status') {
    const { runStatus } = await import('./cli/status.ts');
    process.exit(await runStatus({ port: config.port, home: config.home }));
}

if (config.command === 'closed-lid') {
    const { runClosedLid } = await import('./cli/closed-lid.ts');
    const { closedLidRulePath } = await import('./power/closed-lid.ts');
    const { readLocalSecret } = await import('./auth/local-secret.ts');
    const { readMachineStatus } = await import('./cli/machine-status.ts');
    const { fileExists } = await import('@ruimte/agents/fs');
    const { userInfo } = await import('node:os');
    const uid = process.getuid?.() ?? -1;
    process.exit(
        await runClosedLid({
            action: config.args[0] ?? '',
            platform: process.platform,
            uid,
            user: userInfo().username,
            rulePresent: () => fileExists(closedLidRulePath(uid)),
            runAttached: (command) => Bun.spawn(command, { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' }).exited,
            status: async () => {
                const secret = await readLocalSecret(config.home).catch(() => null);
                if (secret === null) {
                    return null;
                }
                const answer = await readMachineStatus(config.port, secret, (input, init) => fetch(input, init));
                return 'status' in answer ? answer.status : null;
            },
            out: (line) => console.log(line),
            err: (line) => console.error(line)
        })
    );
}

if (config.command === 'login') {
    const { runLogin } = await import('./cli/login.ts');
    // Ctrl+C withdraws the code, so it stops working on the approval page as well.
    const stop = new AbortController();
    process.once('SIGINT', () => stop.abort());
    process.exit(await runLogin({ port: config.port, home: config.home, addressBookUrl: process.env.RUIMTE_PULSAR_URL, signal: stop.signal }));
}

if (config.command === 'logout') {
    const { runLogout } = await import('./cli/logout.ts');
    process.exit(await runLogout({ port: config.port, home: config.home }));
}

if (config.command === 'context') {
    const { runContext } = await import('./cli/context.ts');
    process.exit(await runContext(config.args));
}

// Only after the CLI commands: `ruimte context` runs inside a session and needs these to find it.
forgetInheritedSession(process.env);
// Read into the config already; a shell must not pass it on to a daemon started by hand inside a session.
delete process.env.RUIMTE_SERVICE;

// The daemon installs listeners of its own that let a lost TURN server pass, which these would end the process on.
process.off('uncaughtException', fail);
process.off('unhandledRejection', fail);
try {
    const refused = await startMachine(config, {
        portTaken,
        askRunningMachine,
        start: async () => {
            const { startDaemon } = await import('./daemon.ts');
            await startDaemon(config);
        },
        err: (line) => console.error(line)
    });
    if (refused !== null) {
        process.exit(refused);
    }
} catch (e) {
    fail(e);
}
