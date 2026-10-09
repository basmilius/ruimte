import type { BrowserRouteEvidence } from '../testing/browser-routes.fixture';
import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const desktop = resolve(import.meta.dir, '..');
const client = resolve(desktop, '../client');

test('real Electron guests refuse wrong-machine requests before links, redirects and history while local and public browsers work', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ruimte-browser-routes-'));
    let process: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
    try {
        for (const [entry, output, target] of [
            [join(desktop, 'testing/browser-routes.fixture.ts'), 'main.cjs', 'node'],
            [join(desktop, 'src/preload.ts'), 'preload.cjs', 'node'],
            [join(desktop, 'src/guest.ts'), 'guest.cjs', 'node'],
            [join(client, 'testing/browser-routes.fixture.ts'), 'client.js', 'browser']
        ] as const) {
            const result = await Bun.build({
                entrypoints: [entry],
                target,
                format: target === 'node' ? 'cjs' : 'esm',
                conditions: ['source'],
                external: ['electron'],
                plugins: [
                    {
                        name: 'client-shell-bridge',
                        setup(builder) {
                            builder.onResolve({ filter: /^@adecore\/shell\/bridge$/ }, ({ path }) => ({ path: Bun.resolveSync(path, desktop) }));
                        }
                    }
                ]
            });
            if (!result.success) {
                throw new AggregateError(result.logs, 'Browser route fixture build failed');
            }
            await writeFile(join(directory, output), await result.outputs[0]!.text());
        }
        await writeFile(join(directory, 'index.html'), '<!doctype html><script type="module" src="/client.js"></script>');
        const executable = (await import('electron')).default as unknown as string;
        process = Bun.spawn([executable, join(directory, 'main.cjs')], {
            env: { ...Bun.env, RUIMTE_ROUTE_FIXTURE: directory },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe'
        });
        const [code, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
        if (code !== 0) {
            throw new Error(`Electron fixture exited ${code}\n${stdout}\n${stderr}`);
        }
        const line = stdout.split('\n').find((line) => line.startsWith('BROWSER_ROUTE_RESULT '));
        expect(line).toBeDefined();
        const result = JSON.parse(line!.slice('BROWSER_ROUTE_RESULT '.length)) as BrowserRouteEvidence;
        expect(result.forbidden).toEqual({
            link: 0,
            location: 0,
            form: 0,
            redirect: 0,
            loadURL: 0,
            back: 0,
            forward: 0,
            initial: 0,
            'initial-redirect': 0,
            cached: 0,
            popup: 0,
            fetch: 0,
            image: 0,
            'after-focus': 0,
            unbound: 0
        });
        expect(result.publicRequests).toBeGreaterThanOrEqual(9);
        expect(result.localRequests).toBeGreaterThanOrEqual(3);
        console.log(line);
        for (const evidence of stdout.split('\n').filter((line) => line.startsWith('BROWSER_') && !line.startsWith('BROWSER_ROUTE_RESULT '))) {
            console.log(evidence);
        }
    } finally {
        process?.kill();
        await rm(directory, { recursive: true, force: true });
    }
}, 60_000);
