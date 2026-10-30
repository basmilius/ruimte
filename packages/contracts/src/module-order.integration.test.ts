import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let out: string | null = null;

afterAll(async () => {
    if (out !== null) {
        await rm(out, { recursive: true, force: true });
    }
});

/*
 * A bundler orders a cycle of imports by whichever module it meets first, so a schema can be read before
 * the module that defines it ran. Bun's own loader hides that; the desktop shell's CommonJS bundle does
 * not. Every module, bundled as the entry and then loaded, is what each such order looks like.
 */
test('every module of the contracts loads as the first one a bundle meets', async () => {
    const folder = import.meta.dir;
    const entrypoints = (await readdir(folder)).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts')).map((name) => join(folder, name));
    out = await mkdtemp(join(tmpdir(), 'ruimte-contracts-order-'));
    const built = await Bun.build({ entrypoints, outdir: out, target: 'node', format: 'cjs', conditions: ['source'] });
    expect(built.success).toBe(true);
    const failures: string[] = [];
    for (const output of built.outputs) {
        try {
            require(output.path);
        } catch (e) {
            failures.push(`${output.path}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    expect(failures).toEqual([]);
});
