import { chmod, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
 * wrote: `ruimte`, `ruimte-context` and `ruimte.build`. `--only darwin-arm64` builds the packages
 * for the binaries that exist, which is what a local try on one machine has.
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

await rm(out, { recursive: true, force: true });

for (const target of targets) {
    const source = join(binaries, targetId(target));
    const dir = join(out, targetId(target));
    await mkdir(join(dir, 'bin'), { recursive: true });
    for (const name of ['ruimte', 'ruimte-context', 'ruimte.build']) {
        if (!existsSync(join(source, name))) {
            console.error(`Missing ${join(source, name)}`);
            process.exit(1);
        }
        await copyFile(join(source, name), join(dir, 'bin', name));
    }
    // The Android screen server and its license, which the daemon pushes onto a device from `bin/native`.
    for (const name of ['scrcpy-server', 'scrcpy-server.LICENSE']) {
        if (existsSync(join(source, 'native', name))) {
            await mkdir(join(dir, 'bin', 'native'), { recursive: true });
            await copyFile(join(source, 'native', name), join(dir, 'bin', 'native', name));
        }
    }
    const foundationHelper = join(source, 'native', 'ruimte-foundation-models');
    if (existsSync(foundationHelper)) {
        await mkdir(join(dir, 'bin', 'native'), { recursive: true });
        const targetHelper = join(dir, 'bin', 'native', 'ruimte-foundation-models');
        await copyFile(foundationHelper, targetHelper);
        await copyFile(`${foundationHelper}.NOTICES`, `${targetHelper}.NOTICES`);
        await chmod(targetHelper, 0o755);
    }
    // An artifact download drops the mode, and npm packs the mode it finds.
    await chmod(join(dir, 'bin', 'ruimte'), 0o755);
    await chmod(join(dir, 'bin', 'ruimte-context'), 0o755);
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
