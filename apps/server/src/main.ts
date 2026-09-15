// werift's @peculiar/x509 imports this before tsyringe, but a compiled bundle runs tsyringe first and the daemon dies on start.
import 'reflect-metadata';
import { askRunningMachine, debugFrom, describeError, isAddressInUse, portInUseMessage } from './cli/fatal.ts';
import { forgetInheritedSession, parseServerArgs } from './config.ts';

/*
 * Without a listener Bun prints an uncaught error with a code frame, which in the compiled binary is
 * minified bundle source. A throw at the top level of this module lands here as well.
 */
const fail = (error: unknown): never => {
    console.error(describeError(error, debugFrom(process.env)));
    process.exit(1);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

/*
 * One binary, several jobs: `ruimte` serves, `ruimte pair` prints a pairing URL, `ruimte login` puts
 * the machine on an account with a code, `ruimte service` sets up the background service, `ruimte
 * context` is the agent-side CLI. The daemon is imported only when it is needed, so the CLI commands
 * do not pay for loading the terminal emulator.
 */
const config = parseServerArgs(process.argv.slice(2));

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

if (config.command === 'pair') {
    const { runPair } = await import('./cli/pairing.ts');
    process.exit(await runPair(config.port, config.home));
}

if (config.command === 'login') {
    const { runLogin } = await import('./cli/login.ts');
    // Ctrl+C withdraws the code, so it stops working on the approval page as well.
    const stop = new AbortController();
    process.once('SIGINT', () => stop.abort());
    process.exit(await runLogin({ port: config.port, home: config.home, addressBookUrl: process.env.RUIMTE_PULSAR_URL, signal: stop.signal }));
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
    const { startDaemon } = await import('./daemon.ts');
    await startDaemon(config);
} catch (e) {
    if (!isAddressInUse(e)) {
        fail(e);
    }
    console.error(portInUseMessage(config.port, await askRunningMachine(config.port)));
    process.exit(1);
}
