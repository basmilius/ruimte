import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('browser files get separate processes and a failed file still fails the job without dropping the next file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ruimte-browser-runner-'));
    const evidence = join(directory, 'executed.jsonl');

    try {
        const files = [];

        for (const index of [0, 1]) {
            const file = join(directory, `fixture-${index}.browser.integration.test.ts`);
            await writeFile(
                file,
                `import { expect, test } from 'bun:test';
                import { appendFile } from 'node:fs/promises';
                test('fixture ${index}', async () => {
                    await appendFile(process.env.RUNNER_EVIDENCE_FILE, JSON.stringify({ index: ${index}, pid: process.pid })+'\\n');
                    expect(${index}).toBe(1);
                });`
            );
            files.push(file);
        }

        // The script reads `browser.bunfig.toml` from its working folder. The repository's preloads the React Compiler over the whole client, which takes long and has crashed Bun under load; these fixtures need none of it.
        await writeFile(join(directory, 'browser.bunfig.toml'), '[test]\n');
        const child = Bun.spawn([process.execPath, join(import.meta.dir, 'test-integration.ts'), '--browser', ...files], {
            cwd: directory,
            env: { ...process.env, RUNNER_EVIDENCE_FILE: evidence },
            stdout: 'pipe',
            stderr: 'pipe'
        });
        const [code] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        const executed = (await readFile(evidence, 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as { index: number; pid: number });

        expect(code).toBe(1);
        expect(executed.map((row) => row.index).sort()).toEqual([0, 1]);
        expect(new Set(executed.map((row) => row.pid)).size).toBe(2);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}, 60_000);
