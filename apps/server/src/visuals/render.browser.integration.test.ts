import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { VISUAL_MEASURE_WIDTHS } from '@ruimte/contracts';
import { pngSize } from '../shots.ts';
import { childLauncher, renderCommand, VisualRenderer, type RenderedPreview, type VisualRendererOptions } from './renderer.ts';

const COMMAND = renderCommand(false, process.execPath, ['--conditions=source'], join(import.meta.dir, '..'));

function renderer(options: VisualRendererOptions = {}, env: Record<string, string | undefined> = process.env): VisualRenderer {
    return new VisualRenderer(childLauncher(COMMAND, env), { warn: () => undefined, ...options });
}

const shared = renderer();

/* Whether this machine has a Chrome the render child can start; without one every test here is skipped. */
async function chromeAvailable(): Promise<boolean> {
    try {
        await shared.preview('<p>probe</p>', 320, 'dark');
        return true;
    } catch (e) {
        if ((e as { code?: string }).code === 'preview-unavailable') {
            return false;
        }
        throw e;
    }
}

const available = await chromeAvailable();

async function online(): Promise<boolean> {
    try {
        return (await fetch('https://www.google.com/favicon.ico', { signal: AbortSignal.timeout(3_000) })).ok;
    } catch {
        return false;
    }
}

const isOnline = available && (await online());

const PROFILE_PREFIX = 'ruimte-visual-';

async function profiles(): Promise<string[]> {
    return (await readdir(tmpdir())).filter((name) => name.startsWith(PROFILE_PREFIX));
}

/* The browser processes that still run with one of these profiles. */
function browsersOf(names: readonly string[]): string[] {
    const listing = Bun.spawnSync(['ps', '-axww', '-o', 'pid=,command=']).stdout.toString();
    return listing.split('\n').filter((line) => names.some((name) => line.includes(name)));
}

async function until(check: () => Promise<boolean>, limitMs: number): Promise<boolean> {
    const end = Date.now() + limitMs;
    while (Date.now() < end) {
        if (await check()) {
            return true;
        }
        await Bun.sleep(50);
    }
    return check();
}

/*
 * Runs `work` while it notes every profile folder that appears, then checks that each one, and every
 * browser that ran with it, is gone shortly after: the answer comes before the cleanup.
 */
async function leavesNothing<T>(work: () => Promise<T>, seen = new Set<string>()): Promise<T> {
    const before = new Set(await profiles());
    let done = false;
    const watching = (async () => {
        while (!done) {
            for (const name of await profiles()) {
                if (!before.has(name)) {
                    seen.add(name);
                }
            }
            await Bun.sleep(20);
        }
    })();
    try {
        return await work();
    } finally {
        done = true;
        await watching;
        expect(seen.size).toBeGreaterThan(0);
        const names = [...seen];
        expect(await until(async () => (await profiles()).every((name) => !seen.has(name)) && browsersOf(names).length === 0, 5_000)).toBe(true);
    }
}

function lanAddress(): string | null {
    for (const entries of Object.values(networkInterfaces())) {
        for (const entry of entries ?? []) {
            if (entry.family === 'IPv4' && !entry.internal) {
                return entry.address;
            }
        }
    }
    return null;
}

afterAll(async () => {
    await shared.stop();
});

describe.skipIf(!available)('a preview in a Chrome of its own', () => {
    test('answers a png as wide as asked, the content height, and the console with an uncaught exception at its line', async () => {
        const page = [
            '<!doctype html>',
            '<html><head><title>Bars</title></head>',
            '<body>',
            '<div style="height:333px;background:var(--chart-1)">Bars</div>',
            '<script>',
            "console.log('drawn', 3, { bars: 3 });",
            "console.warn('careful');",
            "console.error('broken');",
            'function draw() { missing(); }',
            'setTimeout(draw, 0);',
            '</script>',
            '</body></html>'
        ].join('\n');
        const preview = await leavesNothing(() => shared.preview(page, 500, 'light'));
        expect(pngSize(preview.png)).toEqual({ width: 500, height: 333 });
        expect(preview.height).toBe(333);
        expect(preview.shotHeight).toBe(333);
        expect(preview.console).toEqual([
            { level: 'log', text: 'drawn 3 {bars: 3}' },
            { level: 'warning', text: 'careful' },
            { level: 'error', text: 'broken' },
            { level: 'exception', text: 'Uncaught ReferenceError: missing is not defined at draw (page.html:9:19)' }
        ]);
        expect(preview.omitted).toBe(0);
    }, 30_000);

    test('a page without a doctype is said to be in quirks mode', async () => {
        const preview = await shared.preview('<div style="height:120px">x</div>', 320, 'dark');
        expect(preview.console).toEqual([
            {
                level: 'warning',
                text: 'The page has no <!doctype html>, so the browser draws it in quirks mode and the frame cannot take the height of the page itself'
            }
        ]);
    }, 30_000);

    test('a page taller than a shot is measured whole and photographed to the limit', async () => {
        const preview = await shared.preview('<!doctype html><div style="height:5000px">tall</div>', 320, 'dark');
        expect(preview.height).toBe(5000);
        expect(preview.shotHeight).toBe(4000);
        expect(pngSize(preview.png)).toEqual({ width: 320, height: 4000 });
    }, 30_000);

    test('a page reaches nothing on this machine or its network, by any path', async () => {
        const hits: string[] = [];
        const server = Bun.serve({
            hostname: '::',
            port: 0,
            fetch: (request) => {
                hits.push(request.url);
                return new Response('<!doctype html><p>reached</p>', { headers: { 'content-type': 'text/html' } });
            }
        });
        let datagrams = 0;
        const udp = await Bun.udpSocket({
            hostname: '127.0.0.1',
            socket: {
                data: () => {
                    datagrams++;
                }
            }
        });
        try {
            const port = server.port;
            const lan = lanAddress();
            const page = `<!doctype html><html><head>
<link rel="prefetch" href="http://127.0.0.1:${port}/prefetch">
<link rel="stylesheet" href="http://localhost:${port}/style.css">
<script type="speculationrules">{"prefetch":[{"source":"list","urls":["http://127.0.0.1:${port}/speculation"]}],"prerender":[{"source":"list","urls":["http://127.0.0.1:${port}/prerender"]}]}</script>
<script src="http://127.0.0.1:${port}/script.js"></script>
</head><body>
<div style="height:250px">stays</div>
<img src="http://127.0.0.1:${port}/image.png">
<img src="http://[::1]:${port}/image-v6.png">
${lan === null ? '' : `<img src="http://${lan}:${port}/image-lan.png">`}
<iframe src="http://127.0.0.1:${port}/frame"></iframe>
<script>
fetch('http://127.0.0.1:${port}/fetch').catch(() => {});
navigator.sendBeacon('http://127.0.0.1:${port}/beacon', 'x');
new WebSocket('ws://127.0.0.1:${port}/socket').onerror = () => {};
window.open('http://127.0.0.1:${port}/popup');
const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${udp.port}' }] });
peer.createDataChannel('probe');
peer.createOffer().then((offer) => peer.setLocalDescription(offer));
try { new WebTransport('https://127.0.0.1:${udp.port}/').ready.catch(() => {}); } catch {}
</script>
</body></html>`;
            const preview = await leavesNothing(() => shared.preview(page, 400, 'dark'));
            expect(preview.height).toBeGreaterThanOrEqual(250);
            const texts = preview.console.map((entry) => entry.text);
            expect(
                texts.some(
                    (text) => text.startsWith(`Blocked a connection to 127.0.0.1:${port}`) || text.startsWith(`Blocked a connection to localhost:${port}`)
                )
            ).toBe(true);
            expect(hits).toEqual([]);
            expect(datagrams).toBe(0);
        } finally {
            udp.close();
            await server.stop(true);
        }
    }, 30_000);

    test('a navigation is reported and leaves the page in place', async () => {
        // Network failures can fill the bounded console before a navigation is reported.
        const address = 'https://elsewhere.invalid/navigate';
        const page = `<!doctype html><div style="height:250px">stays</div><script>location.href = '${address}';</script>`;
        const preview = await leavesNothing(() => shared.preview(page, 400, 'dark'));
        expect(preview.height).toBe(250);
        expect(preview.console.map((entry) => entry.text)).toContain(`The page tried to go to ${address}; a visual stays on its own page`);
    }, 30_000);

    test('a page reads no file of this machine', async () => {
        const folder = await mkdtemp(join(tmpdir(), 'ruimte-canary-'));
        try {
            const canary = join(folder, 'canary.txt');
            await Bun.write(canary, 'canary-7f3a');
            const address = `file://${canary}`;
            const page = `<!doctype html><div style="height:120px">x</div><iframe src="${address}"></iframe><img src="${address}">
<script>
fetch('${address}').then((response) => response.text()).then((text) => console.log('read', text), () => console.log('fetch refused'));
const request = new XMLHttpRequest();
try { request.open('GET', '${address}', false); request.send(); console.log('read', request.responseText); } catch { console.log('request refused'); }
</script>`;
            const preview = await shared.preview(page, 320, 'dark');
            const texts = preview.console.map((entry) => entry.text);
            expect(texts.some((text) => text.includes('canary-7f3a'))).toBe(false);
            expect(texts).toContain('fetch refused');
            expect(texts).toContain('request refused');
        } finally {
            await rm(folder, { recursive: true, force: true });
        }
    }, 30_000);

    test.skipIf(!isOnline)(
        'a public address still loads, on a machine with a network',
        async () => {
            const page = `<!doctype html><img src="https://www.google.com/favicon.ico" onload="console.log('loaded', this.naturalWidth)" onerror="console.log('failed')">`;
            const preview = await shared.preview(page, 320, 'dark');
            expect(preview.console.map((entry) => entry.text)).toContain('loaded 32');
        },
        30_000
    );

    test('measures responsive heights or reports that its deadline was reached', async () => {
        // Twelve boxes of 50px in columns of at least 150px: fewer rows the wider the frame.
        const boxes = Array.from({ length: 12 }, (_, i) => `<div style="height:50px">${i}</div>`).join('');
        const page = `<!doctype html><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">${boxes}</div>`;
        const warnings: string[] = [];
        const measuring = renderer({ warn: (line) => warnings.push(line) });
        try {
            const heights = await leavesNothing(() => measuring.measure(page));
            // The deadline is tested with a manual clock in renderer.test.ts; a busy runner may reach it.
            if (heights === undefined) {
                expect(warnings).toEqual(['Measuring a visual took longer than 6 s, so it is shown without heights']);
            } else {
                expect(warnings).toEqual([]);
                expect(heights.map(([width]) => width)).toEqual([...VISUAL_MEASURE_WIDTHS]);
                const expected = VISUAL_MEASURE_WIDTHS.map((width) => [width, Math.ceil(12 / Math.floor(width / 150)) * 50]);
                expect(heights).toEqual(expected as [number, number][]);
            }
        } finally {
            await measuring.stop();
        }
    }, 30_000);

    test('a child past its limit is killed with its whole browser, and its profile removed', async () => {
        const launch = childLauncher(COMMAND);
        // The child is told it has a minute, so only the limit of the daemon's side can end it.
        const strict = new VisualRenderer((job, budgetMs) => launch(job, budgetMs + 60_000), { previewLimitMs: 4_000, warn: () => undefined });
        const seen = new Set<string>();
        try {
            let browsers = 0;
            const error = await leavesNothing(async () => {
                const refused = strict.preview('<script>while (true) {}</script>', 320, 'dark').then(
                    () => null,
                    (e: unknown) => e as { code: string }
                );
                await until(async () => {
                    browsers = browsersOf([...seen]).length;
                    return browsers > 0;
                }, 3_000);
                return refused;
            }, seen);
            expect(browsers).toBeGreaterThan(0);
            expect(error?.code).toBe('preview-timeout');
        } finally {
            await strict.stop();
        }
    }, 30_000);
});

describe.skipIf(!available)('a render child whose daemon goes', () => {
    test.each(['during startup', 'after Chrome starts'] as const)(
        'removes its browser and profile when stdin closes %s',
        async (when) => {
            const profile = await mkdtemp(join(tmpdir(), PROFILE_PREFIX));
            const child = Bun.spawn(COMMAND, { stdin: 'pipe', stdout: 'ignore', stderr: 'ignore', detached: true });
            try {
                child.stdin.write(
                    `${JSON.stringify({ html: '<script>while (true) {}</script>', widths: [320], appearance: 'dark', capture: true, profile, budgetMs: 60_000 })}\n`
                );
                await child.stdin.flush();
                const name = basename(profile);
                if (when === 'after Chrome starts') {
                    expect(await until(async () => browsersOf([name]).length > 1, 10_000)).toBe(true);
                }
                // What the kernel does to the pipe when the daemon dies, however it dies.
                await child.stdin.end();
                expect(await until(async () => child.exitCode !== null, 5_000)).toBe(true);
                expect(child.exitCode).toBe(0);
                expect(await until(async () => browsersOf([name]).length === 0, 5_000)).toBe(true);
                expect(await profiles()).not.toContain(name);
            } finally {
                try {
                    process.kill(-child.pid, 'SIGKILL');
                } catch {
                    // Gone already.
                }
                await rm(profile, { recursive: true, force: true });
            }
        },
        30_000
    );
});

describe('without a Chrome', () => {
    test('a preview is refused under its own code and a measurement answers no heights', async () => {
        const none = renderer({}, { ...process.env, BUN_CHROME_PATH: join(tmpdir(), 'no-chrome-here') });
        try {
            const error = await none.preview('<p>x</p>', 320, 'dark').then(
                (value: RenderedPreview) => value,
                (e: unknown) => e as { code: string; message: string }
            );
            expect(error).toMatchObject({ code: 'preview-unavailable' });
            expect(await none.measure('<p>x</p>')).toBeUndefined();
        } finally {
            await none.stop();
        }
    }, 30_000);
});
