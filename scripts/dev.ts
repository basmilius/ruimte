import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { hasOwnedProcessMembers, scheduleForcedStop, stopOwnedProcess } from './dev-processes';

const root = resolve(import.meta.dir, '..');
const port = process.env.RUIMTE_PORT ?? '4221';
const vitePort = process.env.RUIMTE_VITE_PORT ?? '5183';
const home = process.env.RUIMTE_DEV_HOME ?? join(homedir(), '.ruimte-rust-dev');
const devUrl = process.env.RUIMTE_DEV_URL ?? `http://localhost:${vitePort}`;
const daemonUrl = process.env.RUIMTE_DAEMON_URL ?? `ws://localhost:${port}`;
const profile = process.env.RUIMTE_DEV_PROFILE ?? 'Ruimte Rust Dev';
const environment = {
    ...process.env,
    RUIMTE_HOME: home,
    RUIMTE_DEV_HOME: home,
    RUIMTE_PORT: port,
    RUIMTE_VITE_PORT: vitePort,
    RUIMTE_DEV_URL: devUrl,
    RUIMTE_DAEMON_URL: daemonUrl,
    RUIMTE_DEV_PROFILE: profile
};

const commands = [
    { command: 'bun', args: [join(root, 'scripts/dev-rust.ts'), '--port', port] },
    { command: 'bun', args: ['run', '--cwd', join(root, 'apps/client'), 'dev', '--', '--port', vitePort] },
    { command: 'bun', args: ['run', '--cwd', join(root, 'apps/desktop'), 'dev'] }
];
const children: ChildProcess[] = commands.map(({ command, args }) =>
    spawn(command, args, { cwd: root, env: environment, stdio: 'inherit', detached: process.platform !== 'win32' })
);
let stopping = false;
let remaining = children.length;
let fallback: ReturnType<typeof setTimeout> | null = null;

const stop = (signal: NodeJS.Signals, exitCode: number): void => {
    if (stopping) {
        return;
    }
    stopping = true;
    process.exitCode = exitCode;
    for (const child of children) {
        stopOwnedProcess(child, signal);
    }
    fallback = scheduleForcedStop(children);
};

process.on('SIGINT', () => stop('SIGINT', 0));
process.on('SIGTERM', () => stop('SIGTERM', 0));
for (const child of children) {
    child.on('error', (error) => {
        console.error(error.message);
        stop('SIGTERM', 1);
    });
    child.on('exit', (code, signal) => {
        remaining -= 1;
        if (!stopping) {
            if (code !== 0) {
                console.error(`Development process exited with ${signal ?? code}`);
            }
            stop('SIGTERM', code ?? 1);
        }
        if (remaining === 0 && fallback !== null && children.every((owned) => !hasOwnedProcessMembers(owned))) {
            clearTimeout(fallback);
        }
    });
}
