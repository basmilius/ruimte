import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { planPublish, publishedFromView, type PackageToPublish } from '../src/publish-plan';
import { LAUNCHER_NAME, targetId, TARGETS } from '../src/targets';

/*
 * Publishes what `build.ts` laid out, platform packages first and `ruimte` last, skipping every
 * version the registry already has. Run by `.github/workflows/npm.yml`, where npm authenticates
 * through the workflow's OIDC token; there is no token to pass.
 *
 *   bun scripts/publish.ts --out <dir> [--dry-run]
 */
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
const dirs = [...TARGETS.map(targetId), LAUNCHER_NAME];
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

const npm = (args: string[], cwd?: string) => {
    const result = Bun.spawnSync(['npm', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', timeout: 5 * 60_000 });
    return { code: result.exitCode ?? 1, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
};

const steps = await planPublish(packages, version!, async (name, wanted) => publishedFromView(wanted, npm(['view', `${name}@${wanted}`, 'version'])));

for (const step of steps) {
    if (step.action === 'skip') {
        console.log(`${step.name}@${version} is already on npm; skipped.`);
        continue;
    }
    const args = ['publish', '--access', 'public', ...(step.tag ? ['--tag', step.tag] : []), ...(values['dry-run'] ? ['--dry-run'] : [])];
    console.log(`npm ${args.join(' ')} (${step.name}@${version})`);
    const result = Bun.spawnSync(['npm', ...args], { cwd: step.dir, stdio: ['ignore', 'inherit', 'inherit'], timeout: 10 * 60_000 });
    if (result.exitCode !== 0) {
        // Stopping here keeps `ruimte` from going out while a binary it names is missing.
        console.error(`Publishing ${step.name} failed; nothing after it was published.`);
        process.exit(result.exitCode ?? 1);
    }
}
