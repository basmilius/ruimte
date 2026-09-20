import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The helper only builds against the ONNX Runtime the release ships, which is macOS only for now.
if (process.platform !== 'darwin') {
    process.exit(0);
}

const installed = join(homedir(), '.cargo', 'bin', 'cargo');
const cargo = process.env.CARGO ?? (existsSync(installed) ? installed : 'cargo');
const manifest = join(dirname(fileURLToPath(import.meta.url)), '../../speech-bridge/Cargo.toml');
const build = spawnSync(cargo, ['build', '--release', '--locked', '--manifest-path', manifest], { stdio: ['ignore', 'inherit', 'inherit'] });
if (build.error) {
    console.error(build.error.message);
}
process.exit(build.status ?? 1);
