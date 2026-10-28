import type { RenderDistanceEvidence } from '../testing/render-distance.fixture';
import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const desktop = resolve(import.meta.dir, '..');
const client = resolve(desktop, '../client');

test('a real page past the render distance is hidden in its host, keeps its guest, input, scroll and history, and can still be photographed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ruimte-render-distance-'));
    let process: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
    try {
        for (const [entry, output, target] of [
            [join(desktop, 'testing/render-distance.fixture.ts'), 'main.cjs', 'node'],
            [join(desktop, 'src/preload.ts'), 'preload.cjs', 'node'],
            [join(desktop, 'src/guest.ts'), 'guest.cjs', 'node'],
            [join(client, 'testing/render-distance.fixture.ts'), 'client.js', 'browser']
        ] as const) {
            const result = await Bun.build({
                entrypoints: [entry],
                target,
                format: target === 'node' ? 'cjs' : 'esm',
                conditions: ['source'],
                external: ['electron'],
                define: target === 'browser' ? { 'import.meta.env': JSON.stringify({ DEV: false, PROD: true, MODE: 'test', BASE_URL: '/' }) } : {},
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
                throw new AggregateError(result.logs, 'Render distance fixture build failed');
            }
            await writeFile(join(directory, output), await result.outputs[0]!.text());
        }
        await writeFile(join(directory, 'index.html'), '<!doctype html><body style="margin:0"><script type="module" src="/client.js"></script></body>');
        const executable = (await import('electron')).default as unknown as string;
        process = Bun.spawn([executable, join(directory, 'main.cjs')], {
            env: { ...Bun.env, RUIMTE_DISTANCE_FIXTURE: directory },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe'
        });
        const [code, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
        if (code !== 0) {
            throw new Error(`Electron fixture exited ${code}\n${stdout}\n${stderr}`);
        }
        const line = stdout.split('\n').find((line) => line.startsWith('RENDER_DISTANCE_RESULT '));
        expect(line).toBeDefined();
        const result = JSON.parse(line!.slice('RENDER_DISTANCE_RESULT '.length)) as RenderDistanceEvidence;
        console.log(line);
        expect(result).toMatchObject({ sameGuest: true, sameHost: true, field: 'typed by hand', scroll: 900, canGoBack: true, extraLoads: 0 });
        expect(result.history[1]).toBe(result.history[0]);
        // Hidden, Chromium stops drawing the page: that is the whole saving.
        expect(result.rafHidden).toBe(0);
        expect(result.pictureBytes).toBeGreaterThan(0);
        expect(result.shotBytes).toBeGreaterThan(0);
    } finally {
        process?.kill();
        await rm(directory, { recursive: true, force: true });
    }
}, 90_000);
