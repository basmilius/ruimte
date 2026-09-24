import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { platformPackageOf } from './launcher';

/*
 * The whole chain on this machine: `compile.ts` builds the host binary, `build.ts` lays out the
 * packages, and Node runs the launcher against them the way npm would install them.
 */
const repoRoot = join(import.meta.dir, '..', '..', '..');
const work = mkdtempSync(join(tmpdir(), 'ruimte-npm-'));

afterAll(() => {
    rmSync(work, { recursive: true, force: true });
});

// The timeout is a budget for a real build, not a wait: on a cold runner compile.ts builds both Rust helpers.
test('node runs the launcher, which runs the compiled binary', () => {
    const target = `${process.platform}-${process.arch}`;
    const version = '0.0.0-integration';
    const compile = Bun.spawnSync(['bun', 'apps/server/scripts/compile.ts', '--target', target, '--outdir', join(work, 'binaries', target)], {
        cwd: repoRoot,
        env: { ...process.env, RUIMTE_VERSION: version },
        stdio: ['ignore', 'inherit', 'inherit']
    });
    expect(compile.exitCode).toBe(0);

    const out = join(work, 'packages');
    const build = Bun.spawnSync(
        ['bun', 'packages/npm/scripts/build.ts', '--version', version, '--binaries', join(work, 'binaries'), '--out', out, '--only', target],
        { cwd: repoRoot, stdio: ['ignore', 'inherit', 'inherit'] }
    );
    expect(build.exitCode).toBe(0);

    const scope = join(out, 'ruimte', 'node_modules', '@ruimte');
    mkdirSync(scope, { recursive: true });
    symlinkSync(join(out, target), join(scope, platformPackageOf({ platform: process.platform, arch: process.arch }).split('/')[1]!));

    const run = Bun.spawnSync(['node', join(out, 'ruimte', 'bin', 'ruimte.js'), '--version'], { stdout: 'pipe', stderr: 'pipe' });
    expect(run.stderr.toString()).toBe('');
    expect(run.stdout.toString().trim()).toBe(version);
    expect(run.exitCode).toBe(0);
}, 900_000);
