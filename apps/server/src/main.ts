import { forgetInheritedSession, parseServerArgs } from './config.ts';

/*
 * One binary, three jobs: `ruimte` serves, `ruimte pair` prints a pairing URL, `ruimte context`
 * is the agent-side CLI. The daemon is imported only when it is needed, so the CLI commands do
 * not pay for loading the terminal emulator.
 */
const config = parseServerArgs(process.argv.slice(2));

if (config.command === 'pair') {
    const { runPair } = await import('./cli/pairing.ts');
    process.exit(await runPair(config.port, config.home));
}

if (config.command === 'context') {
    const { runContext } = await import('./cli/context.ts');
    process.exit(await runContext(config.args));
}

// Only after the CLI commands: `ruimte context` runs inside a session and needs these to find it.
forgetInheritedSession(process.env);
// Read into the config already; a shell must not pass it on to a daemon started by hand inside a session.
delete process.env.RUIMTE_SERVICE;

const { startDaemon } = await import('./daemon.ts');
await startDaemon(config);
