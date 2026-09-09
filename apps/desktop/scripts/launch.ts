import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

/*
 * Starts Electron with a clean environment. A terminal inside another Electron app (an IDE, an
 * agent shell) exports ELECTRON_RUN_AS_NODE, which would turn our shell into a plain Node process.
 */
const require = createRequire(import.meta.url);
const electron = require('electron') as string;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
