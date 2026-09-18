import { chmod, copyFile, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { launcherManifest, platformManifest } from '../src/manifest';
import { LAUNCHER_NAME, targetId, TARGETS } from '../src/targets';

/*
 * Lays out every package that goes to npm, ready for `npm publish` in each folder:
 *
 *   bun scripts/build.ts --version 0.2.0 --binaries <dir> --out <dir>
 *
 * `--binaries` holds one folder per target (`darwin-arm64/`, ...), each what `compile.ts --target`
 * wrote. `--only darwin-arm64` builds the packages for the binaries that exist, which is what a
 * local try on one machine has.
 */
const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        version: { type: 'string' },
        binaries: { type: 'string' },
        out: { type: 'string' },
        only: { type: 'string', multiple: true, default: [] }
    },
    strict: true
});

if (!values.version || !values.binaries || !values.out) {
    console.error('Usage: bun scripts/build.ts --version <version> --binaries <dir> --out <dir> [--only <os-cpu>]');
    process.exit(1);
}

const packageRoot = join(import.meta.dir, '..');
const repoRoot = join(packageRoot, '..', '..');
const binaries = resolve(values.binaries);
const out = resolve(values.out);
const version = values.version;
const targets = values.only.length > 0 ? TARGETS.filter((target) => values.only.includes(targetId(target))) : TARGETS;

const writeJson = (path: string, value: unknown): Promise<void> => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

interface BundleManifest {
    format: number;
    version: string;
    buildId: string;
    target: { os: string; arch: string };
}

const copyBundleEntry = async (source: string, destination: string): Promise<void> => {
    const entry = await lstat(source);
    if (entry.isSymbolicLink()) {
        throw new Error(`Refusing symlink in native bundle: ${source}`);
    }
    if (entry.isDirectory()) {
        await mkdir(destination, { recursive: true });
        for (const name of await readdir(source)) {
            await copyBundleEntry(join(source, name), join(destination, name));
        }
        return;
    }
    if (!entry.isFile()) {
        throw new Error(`Refusing unsupported entry in native bundle: ${source}`);
    }
    await copyFile(source, destination);
};

const readBundle = async (source: string, target: (typeof TARGETS)[number]): Promise<string[]> => {
    const manifestPath = join(source, 'ruimte.bundle.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BundleManifest;
    const os = target.os === 'darwin' ? 'mac' : target.os;
    if (
        manifest.format !== 1 ||
        manifest.version !== version ||
        typeof manifest.buildId !== 'string' ||
        manifest.buildId.length === 0 ||
        manifest.target?.os !== os ||
        manifest.target.arch !== target.cpu
    ) {
        throw new Error(`Native bundle metadata does not match ${targetId(target)} ${version}`);
    }
    if ((await readFile(join(source, 'ruimte.build'), 'utf8')).trim() !== manifest.buildId) {
        throw new Error(`Native bundle build marker does not match ${manifest.buildId}`);
    }

    const allowed = new Set(['ruimte', 'ruimte-context', 'ruimte.build', 'ruimte.bundle.json', 'web']);
    const required = ['ruimte', 'ruimte-context', 'ruimte.build', 'ruimte.bundle.json'];
    if (target.os === 'darwin') {
        allowed.add('ruimte-simulator-helper');
        allowed.add('native');
        required.push('ruimte-simulator-helper', 'native');
    }
    const names = await readdir(source);
    const unexpected = names.find((name) => !allowed.has(name));
    if (unexpected) {
        throw new Error(`Unexpected native bundle entry: ${join(source, unexpected)}`);
    }
    for (const name of required) {
        await lstat(join(source, name)).catch(() => {
            throw new Error(`Missing ${join(source, name)}`);
        });
    }
    if (target.os === 'darwin') {
        for (const name of ['serve-sim-ax-settings', 'serve-sim-native.node']) {
            await lstat(join(source, 'native', name)).catch(() => {
                throw new Error(`Missing ${join(source, 'native', name)}`);
            });
        }
    }
    return names;
};

await rm(out, { recursive: true, force: true });

for (const target of targets) {
    const source = join(binaries, targetId(target));
    const dir = join(out, targetId(target));
    await mkdir(join(dir, 'bin'), { recursive: true });
    for (const name of await readBundle(source, target)) {
        await copyBundleEntry(join(source, name), join(dir, 'bin', name));
    }
    // GitHub's artifact download does not retain modes, while npm packs the modes on disk.
    await chmod(join(dir, 'bin', 'ruimte'), 0o755);
    await chmod(join(dir, 'bin', 'ruimte-context'), 0o755);
    if (target.os === 'darwin') {
        await chmod(join(dir, 'bin', 'ruimte-simulator-helper'), 0o755);
        await chmod(join(dir, 'bin', 'native', 'serve-sim-ax-settings'), 0o755);
    }
    await writeJson(join(dir, 'package.json'), platformManifest(target, version));
    await copyFile(join(repoRoot, 'LICENSE'), join(dir, 'LICENSE'));
    console.log(`Laid out ${dir}`);
}

const launcherDir = join(out, LAUNCHER_NAME);
await mkdir(join(launcherDir, 'bin'), { recursive: true });
const bundle = await Bun.build({ entrypoints: [join(packageRoot, 'src', 'bin.ts')], target: 'node', format: 'esm' });
if (!bundle.success) {
    console.error(bundle.logs.join('\n'));
    process.exit(1);
}
const launcherPath = join(launcherDir, 'bin', 'ruimte.js');
await writeFile(launcherPath, await bundle.outputs[0]!.text());
await chmod(launcherPath, 0o755);
await writeJson(join(launcherDir, 'package.json'), launcherManifest(version));
await copyFile(join(packageRoot, 'README.md'), join(launcherDir, 'README.md'));
await copyFile(join(repoRoot, 'LICENSE'), join(launcherDir, 'LICENSE'));
console.log(`Laid out ${launcherDir}`);
