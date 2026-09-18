import { access, chmod, copyFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        target: { type: 'string' },
        outfile: { type: 'string' }
    },
    strict: true
});

if (!values.target || !['aarch64-apple-darwin', 'x86_64-apple-darwin'].includes(values.target) || !values.outfile) {
    console.error('Usage: bun scripts/build.ts --target <aarch64-apple-darwin|x86_64-apple-darwin> --outfile <path>');
    process.exit(1);
}
if (process.platform !== 'darwin') {
    console.error('The iOS device bridge must be built and signed on macOS.');
    process.exit(1);
}

const root = resolve(import.meta.dir, '..');
const cargoFallback = join(homedir(), '.cargo', 'bin', 'cargo');
const cargo =
    process.env.CARGO ||
    Bun.which('cargo') ||
    ((await access(cargoFallback)
        .then(() => true)
        .catch(() => false))
        ? cargoFallback
        : null);
if (!cargo) {
    console.error('Cargo is required to build the iOS device bridge.');
    process.exit(1);
}

const build = Bun.spawnSync([cargo, 'build', '--release', '--locked', '--target', values.target], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit']
});
if (build.exitCode !== 0) {
    process.exit(build.exitCode);
}

const output = resolve(values.outfile);
await mkdir(dirname(output), { recursive: true });
await copyFile(join(root, 'target', values.target, 'release', 'ios-device-bridge'), output);
await chmod(output, 0o755);
const sign = Bun.spawnSync(['codesign', '--sign', '-', '--force', output], { stdio: ['ignore', 'ignore', 'inherit'] });
if (sign.exitCode !== 0) {
    process.exit(sign.exitCode);
}
