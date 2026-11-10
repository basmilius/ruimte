import { join } from 'node:path';
import { DEV_PORT, devRuimteHome } from '@ruimte/service/runtime';

/*
 * The development daemon, on its own port and home so it never meets an installed Ruimte. A script
 * rather than `RUIMTE_HOME=${RUIMTE_DEV_HOME:-$HOME/.ruimte-dev}` in package.json: Bun's shell on
 * Windows has neither that default nor a HOME.
 */
const env = { ...process.env, RUIMTE_HOME: devRuimteHome() };
const child = Bun.spawn(['bun', '--conditions=source', '--watch', 'src/main.ts', '--port', String(DEV_PORT), ...process.argv.slice(2)], {
    cwd: join(import.meta.dir, '..'),
    env,
    stdio: ['inherit', 'inherit', 'inherit']
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal));
}
process.exit(await child.exited);
