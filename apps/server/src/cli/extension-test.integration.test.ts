import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { scaffoldFiles } from '../extensions/scaffold.ts';

const MAIN = join(import.meta.dir, '..', 'main.ts');
const root = mkdtempSync(join(process.env.RUIMTE_INTEGRATION_FIXTURE_ROOT ?? tmpdir(), 'ruimte-extension-test-'));

/* `ruimte extension test` in a folder, as an author runs it. */
async function extensionTest(folder: string): Promise<{ code: number; output: string }> {
    const child = Bun.spawn([process.execPath, MAIN, 'extension', 'test'], { cwd: folder, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);

    return { code, output: `${stdout}${stderr}` };
}

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('ruimte extension test', () => {
    test('runs the tests of extensions/limits against the fake host', async () => {
        const { code, output } = await extensionTest(join(import.meta.dir, '../../../../extensions/limits'));

        expect(output).toContain(' 0 fail');
        expect(code).toBe(0);
    });

    test('passes the example test a new project starts with, before anything is installed', async () => {
        const folder = join(root, 'builds');
        const files = scaffoldFiles({ name: "Bas's builds", id: 'acme.builds', description: '', parts: 'both', surface: 'panel', git: false });

        for (const [path, text] of Object.entries(files)) {
            mkdirSync(dirname(join(folder, path)), { recursive: true });
            writeFileSync(join(folder, path), text);
        }

        const { code, output } = await extensionTest(folder);

        expect(output).toContain(' 2 pass');
        expect(code).toBe(0);
    });
});
