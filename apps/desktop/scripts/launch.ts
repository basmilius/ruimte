import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAUNCHER_PIPE_VARIABLE } from '../src/launcher-pipe';
import { prepareMacDevelopmentApp } from './mac-dev-app';

/*
 * Starts Electron with a clean environment. A terminal inside another Electron app (an IDE, an
 * agent shell) exports ELECTRON_RUN_AS_NODE, which would turn our shell into a plain Node process.
 */
const require = createRequire(import.meta.url);
const electron = require('electron') as string;
const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const executable = process.platform === 'darwin' ? prepareMacDevelopmentApp(electron, join(scriptsDirectory, '..', 'dist')) : electron;
const env: NodeJS.ProcessEnv = { ...process.env, [LAUNCHER_PIPE_VARIABLE]: '3' };
delete env.ELECTRON_RUN_AS_NODE;

// The fourth descriptor is a pipe Electron watches: it quits the moment this script is gone, however it went.
const child = spawn(executable, ['.', ...process.argv.slice(2)], { stdio: ['inherit', 'inherit', 'inherit', 'pipe'], env });
child.on('exit', (code) => process.exit(code ?? 0));

// Stopping `bun dev` closes the pipe rather than ending this script, so Electron's exit still ends it with Electron's code.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
        child.stdio[3]?.destroy();
    });
}
