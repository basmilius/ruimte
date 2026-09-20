import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const installed = join(homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
const cargo = process.env.CARGO ?? (existsSync(installed) ? installed : 'cargo');
const manifest = join(dirname(fileURLToPath(import.meta.url)), '../../speech-bridge/Cargo.toml');
const build = spawnSync(cargo, ['build', '--release', '--locked', '--manifest-path', manifest], { stdio: ['ignore', 'inherit', 'inherit'] });
if (build.error) {
    console.error(build.error.message);
}
process.exit(build.status ?? 1);
