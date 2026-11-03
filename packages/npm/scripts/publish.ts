import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { EXTENSION_DIR } from '../src/manifest';
import { landedAfterAll, latestFromView, planPublish, publishedFromView, type PackageToPublish, type RegistryLookup } from '../src/publish-plan';
import { LAUNCHER_NAME } from '../src/targets';

/* Publishes the platform binaries and the extension API's types before the launcher, skipping versions already on npm.
   Shared libraries are published by Adecore's workflow. */
const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        out: { type: 'string' },
        'dry-run': { type: 'boolean', default: false }
    },
    strict: true
});

if (!values.out) {
    console.error('Usage: bun scripts/publish.ts --out <dir> [--dry-run]');
    process.exit(1);
}

const out = resolve(values.out);
const launcherPath = join(out, LAUNCHER_NAME, 'package.json');
if (!existsSync(launcherPath)) {
    console.error(`Missing ${launcherPath}; every package goes out together.`);
    process.exit(1);
}
// The launcher names the platforms this release ships (`build.ts --skip` leaves one out), and each of them goes out with it.
const launcher = JSON.parse(await readFile(launcherPath, 'utf8')) as { optionalDependencies?: Record<string, string> };
const dirs = [...Object.keys(launcher.optionalDependencies ?? {}).map((name) => name.replace(/^@ruimte\//, '')), EXTENSION_DIR, LAUNCHER_NAME];
const packages: PackageToPublish[] = [];
let version: string | null = null;
for (const dir of dirs) {
    const path = join(out, dir, 'package.json');
    if (!existsSync(path)) {
        console.error(`Missing ${path}; every package goes out together.`);
        process.exit(1);
    }
    const manifest = JSON.parse(await readFile(path, 'utf8')) as { name: string; version: string };
    if (version !== null && manifest.version !== version) {
        console.error(`${manifest.name} is at ${manifest.version}, the others at ${version}.`);
        process.exit(1);
    }
    version = manifest.version;
    packages.push({ name: manifest.name, dir: join(out, dir) });
}

function npm(args: string[], cwd?: string) {
    const result = Bun.spawnSync(['npm', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', timeout: 5 * 60_000 });
    return { code: result.exitCode ?? 1, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

// `--prefer-online` skips npm's cache; the registry's own lag after a publish remains.
const registry: RegistryLookup = {
    published: async (name, wanted) => publishedFromView(wanted, npm(['view', `${name}@${wanted}`, 'version', '--prefer-online'])),
    latest: async (name) => latestFromView(npm(['view', name, 'dist-tags.latest', '--prefer-online']))
};
const steps = await planPublish(packages, version!, registry);

for (const step of steps) {
    if (step.action === 'skip') {
        console.log(`${step.name}@${version} is already on npm; skipped.`);
        continue;
    }
    const args = ['publish', '--access', 'public', '--tag', step.tag, ...(values['dry-run'] ? ['--dry-run'] : [])];
    console.log(`npm ${args.join(' ')} (${step.name}@${version})`);
    const result = Bun.spawnSync(['npm', ...args], { cwd: step.dir, stdio: ['ignore', 'inherit', 'inherit'], timeout: 10 * 60_000 });
    if (result.exitCode !== 0 && !values['dry-run'] && (await landedAfterAll(registry, step.name, version!, () => Bun.sleep(20_000)))) {
        console.log(`${step.name}@${version} is on npm after all; going on.`);
        continue;
    }
    if (result.exitCode !== 0) {
        // Stopping here keeps `ruimte` from going out while a binary it names is missing.
        console.error(`Publishing ${step.name} failed; nothing after it was published.`);
        process.exit(result.exitCode ?? 1);
    }
}
