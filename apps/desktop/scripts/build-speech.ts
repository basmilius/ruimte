import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Apple Speech is macOS only, and so is the helper.
if (process.platform !== 'darwin') {
    process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '../../speech-bridge');
const build = spawnSync('swift', ['build', '-c', 'release', '--product', 'speech-bridge'], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });

if (build.error) {
    console.error(build.error.message);
}

process.exit(build.status ?? 1);
