import { join } from 'node:path';
import { DEV_PORT, devRuimteHome } from '@ruimte/service/runtime';

/*
 * The development daemon, on its own port and home so it never meets an installed Ruimte. A script
 * rather than `RUIMTE_HOME=${RUIMTE_DEV_HOME:-$HOME/.ruimte-dev}` in package.json: Bun's shell on
 * Windows has neither that default nor a HOME.
 */
const cwd = join(import.meta.dir, '..');
// The checkout by name, for an extension that takes the machine it puts somewhere else from here (`extensions/devcontainers`).
const env = { ...process.env, RUIMTE_HOME: devRuimteHome(), RUIMTE_DEV_CHECKOUT: join(cwd, '..', '..') };
const child = Bun.spawn(['bun', '--conditions=source', '--watch', 'src/main.ts', '--port', String(DEV_PORT), ...process.argv.slice(2)], {
    cwd,
    env,
    stdio: ['inherit', 'inherit', 'inherit']
});
// Beside the daemon and never part of it: the one place that links the development extensions, so nothing else loads them.
const extensions = Bun.spawn(['bun', '--conditions=source', 'scripts/dev-extensions.ts'], { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
        child.kill(signal);
        extensions.kill(signal);
    });
}
const code = await child.exited;
extensions.kill();
process.exit(code);
