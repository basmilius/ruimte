import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { EXTENSION_DIR, extensionManifest, launcherManifest, platformManifest } from '../src/manifest';
import { binaryNameOf, LAUNCHER_NAME, targetId, TARGETS } from '../src/targets';

/*
 * Lays out every package that goes to npm, ready for `npm publish` in each folder:
 *
 *   bun scripts/build.ts --version 0.2.0 --binaries <dir> --out <dir>
 *
 * `--binaries` holds one folder per target (`darwin-arm64/`, ...), each what `compile.ts --target`
 * wrote: `ruimte` (`ruimte.exe` on Windows) and `ruimte.build`. `--only darwin-arm64`
 * builds the packages for the binaries that exist, which is what a local try on one machine has.
 * `--skip win32-x64` leaves a platform out of the release, the launcher's dependencies included.
 * `@ruimte/extension` goes in `extension/`, the types of `packages/extension` at the same version.
 */
const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        version: { type: 'string' },
        binaries: { type: 'string' },
        out: { type: 'string' },
        only: { type: 'string', multiple: true, default: [] },
        skip: { type: 'string', multiple: true, default: [] }
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
const released = TARGETS.filter((target) => !values.skip.includes(targetId(target)));
const targets = values.only.length > 0 ? released.filter((target) => values.only.includes(targetId(target))) : released;

function writeJson(path: string, value: unknown): Promise<void> {
    return writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/* A helper the compiled daemon carries in `native/`, with the files that go beside it; nothing when this build has none. */
async function copyNative(source: string, dir: string, name: string, beside: readonly string[] = [], executable = false): Promise<void> {
    if (!existsSync(join(source, 'native', name))) {
        return;
    }

    const native = join(dir, 'bin', 'native');
    await mkdir(native, { recursive: true });

    for (const file of [name, ...beside]) {
        await copyFile(join(source, 'native', file), join(native, file));
    }

    if (executable) {
        await chmod(join(native, name), 0o755);
    }
}

await rm(out, { recursive: true, force: true });

for (const target of targets) {
    const source = join(binaries, targetId(target));
    const dir = join(out, targetId(target));
    await mkdir(join(dir, 'bin'), { recursive: true });
    const binary = binaryNameOf(target.os);
    const files = [binary, 'ruimte.build'];
    for (const name of files) {
        if (!existsSync(join(source, name))) {
            console.error(`Missing ${join(source, name)}`);
            process.exit(1);
        }
        await copyFile(join(source, name), join(dir, 'bin', name));
    }
    // The Android screen server and its license, which the daemon pushes onto a device from `bin/native`.
    await copyNative(source, dir, 'scrcpy-server');
    await copyNative(source, dir, 'scrcpy-server.LICENSE');
    await copyNative(source, dir, target.os === 'win32' ? 'adecore-database.exe' : 'adecore-database', ['adecore-database.LICENSE'], true);

    // An artifact download drops the mode, and npm packs the mode it finds.
    for (const name of files.filter((file) => file !== 'ruimte.build')) {
        await chmod(join(dir, 'bin', name), 0o755);
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
await writeJson(join(launcherDir, 'package.json'), launcherManifest(version, released));
await copyFile(join(packageRoot, 'README.md'), join(launcherDir, 'README.md'));
await copyFile(join(repoRoot, 'LICENSE'), join(launcherDir, 'LICENSE'));
console.log(`Laid out ${launcherDir}`);

// The types need no binary, so a try with `--only` lays them out as well.
const extensionSource = join(repoRoot, 'packages', 'extension');
const extensionDir = join(out, EXTENSION_DIR);
await mkdir(extensionDir, { recursive: true });
for (const name of new Bun.Glob('*.d.ts').scanSync({ cwd: extensionSource })) {
    await copyFile(join(extensionSource, name), join(extensionDir, name));
}
const extensionSourceManifest = JSON.parse(await readFile(join(extensionSource, 'package.json'), 'utf8')) as Record<string, unknown>;
await writeJson(join(extensionDir, 'package.json'), extensionManifest(extensionSourceManifest, version));
console.log(`Laid out ${extensionDir}`);
