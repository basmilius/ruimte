import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareMacDevelopmentApp } from './mac-dev-app';

/*
 * Starts Electron with a clean environment. A terminal inside another Electron app (an IDE, an
 * agent shell) exports ELECTRON_RUN_AS_NODE, which would turn our shell into a plain Node process.
 */
const require = createRequire(import.meta.url);
const electron = require('electron') as string;
const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const executable = process.platform === 'darwin' ? prepareMacDevelopmentApp(electron, join(scriptsDirectory, '..', 'dist')) : electron;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(executable, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
