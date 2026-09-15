import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

/*
 * Compiles the daemon into one executable per platform, with the `ruimte-context` script next
 * to it, under `dist/<os>-<arch>/`. The folder names follow electron-builder's macros, so the
 * desktop build picks the right one with `${os}-${arch}`.
 *
 *   bun scripts/compile.ts                       the machine it runs on
 *   bun scripts/compile.ts --os mac --arch x64   cross-compile
 */
const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        os: { type: 'string', default: process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux' },
        arch: { type: 'string', default: process.arch }
    },
    strict: true
});

const bunOs: Record<string, string> = { mac: 'darwin', linux: 'linux', win: 'windows' };
if (!(values.os in bunOs) || !['x64', 'arm64'].includes(values.arch)) {
    console.error(`Unsupported target ${values.os}-${values.arch}`);
    process.exit(1);
}

const root = join(import.meta.dir, '..');
const outDir = join(root, 'dist', `${values.os}-${values.arch}`);
const binary = join(outDir, values.os === 'win' ? 'ruimte.exe' : 'ruimte');
await mkdir(outDir, { recursive: true });

const args = ['build', '--compile', `--target=bun-${bunOs[values.os]}-${values.arch}`, '--minify', join(root, 'src', 'main.ts'), '--outfile', binary];
// A release believes the pinned statement keys and nothing else, whatever its environment holds.
args.push('--define', 'process.env.RUIMTE_PULSAR_TEST_STATEMENT_KEY=""');
if (process.env.RUIMTE_VERSION) {
    args.push('--define', `process.env.RUIMTE_VERSION=${JSON.stringify(process.env.RUIMTE_VERSION)}`);
}
// The same id goes into the binary and into `ruimte.build` beside it, which is how the desktop app
// tells the daemon in its bundle from an older one still running as the background service.
const buildId = `${process.env.RUIMTE_VERSION ?? 'dev'}-${crypto.randomUUID()}`;
args.push('--define', `process.env.RUIMTE_BUILD=${JSON.stringify(buildId)}`);
const build = Bun.spawnSync(['bun', ...args], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
if (build.exitCode !== 0) {
    process.exit(build.exitCode);
}

if (values.os === 'mac' && process.platform === 'darwin') {
    // Bun 1.4 writes the bundle after signing, which leaves a signature the kernel refuses (SIGKILL on launch); an ad-hoc re-sign fixes it and a release signs again with the real identity anyway.
    const sign = Bun.spawnSync(['codesign', '--sign', '-', '--force', binary], { stdio: ['ignore', 'ignore', 'inherit'] });
    if (sign.exitCode !== 0) {
        process.exit(sign.exitCode);
    }
}

await copyFile(join(root, 'bin', 'ruimte-context'), join(outDir, 'ruimte-context'));
await chmod(join(outDir, 'ruimte-context'), 0o755);
await writeFile(join(outDir, 'ruimte.build'), `${buildId}\n`);
console.log(`Compiled ${binary}`);
