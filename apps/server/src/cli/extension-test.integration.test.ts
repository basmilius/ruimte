import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CLIENT_REACT_MAJOR, scaffoldFiles } from '../extensions/scaffold.ts';

const MAIN = join(import.meta.dir, '..', 'main.ts');
const root = mkdtempSync(join(process.env.RUIMTE_INTEGRATION_FIXTURE_ROOT ?? tmpdir(), 'ruimte-extension-test-'));

/* `ruimte extension test` in a folder, as an author runs it. */
async function extensionTest(folder: string): Promise<{ code: number; output: string }> {
    const child = Bun.spawn([process.execPath, MAIN, 'extension', 'test'], { cwd: folder, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);

    return { code, output: `${stdout}${stderr}` };
}

/* A new project as `ruimte extension create` writes it, with nothing installed. */
function scaffolded(name: string): string {
    const folder = join(root, name);
    const files = scaffoldFiles({ name: "Bas's builds", id: 'acme.builds', description: '', parts: 'both', surface: 'panel', git: false });

    for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(folder, path)), { recursive: true });
        writeFileSync(join(folder, path), text);
    }

    return folder;
}

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('ruimte extension test', () => {
    test.each(['limits', 'poc-server', 'poc-agents', 'poc-workspace'])('runs the tests of extensions/%s against the test host', async (name) => {
        const { code, output } = await extensionTest(join(import.meta.dir, '../../../../extensions', name));

        expect(output).toContain(' 0 fail');
        expect(code).toBe(0);
    });

    test('passes the example test a new project starts with, before anything is installed', async () => {
        const folder = scaffolded('builds');
        const { code, output } = await extensionTest(folder);

        expect(output).toContain(' 2 pass');
        expect(code).toBe(0);
    });

    test('warns when the project tests with another React than Ruimte draws extensions with', async () => {
        const folder = scaffolded('react');

        mkdirSync(join(folder, 'node_modules', 'react'), { recursive: true });
        writeFileSync(join(folder, 'node_modules', 'react', 'package.json'), JSON.stringify({ name: 'react', version: '18.3.1' }));

        const { output } = await extensionTest(folder);

        expect(output).toContain(`This project tests with React 18.3.1, and Ruimte draws extensions with React ${CLIENT_REACT_MAJOR}`);
    });

    test('says what to add when a test draws into a page and happy-dom is not there', async () => {
        const folder = scaffolded('page');

        writeFileSync(join(folder, 'test', 'main.dom.test.tsx'), "import { test } from 'bun:test';\n\ntest('draws', () => undefined);\n");

        const { code, output } = await extensionTest(folder);

        expect(output).toContain(
            'A *.dom.test.tsx file draws into a page, which needs @happy-dom/global-registrator. Add it with: bun add -d @happy-dom/global-registrator'
        );
        expect(code).toBe(1);
    });
});
