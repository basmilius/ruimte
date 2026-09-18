import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EVENT_SCHEMAS, LIVE_STREAM_MAGIC, LiveStreamDecoder, REQUEST_SCHEMAS } from '../../../packages/contracts/src';

const root = resolve(import.meta.dir, '../../..');

test('native Chromium navigation, input and live streaming use the authenticated daemon', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-browser-'));
    const reports: Array<Record<string, unknown>> = [];
    const fixture = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: async (request) => {
            const url = new URL(request.url);
            if (url.pathname === '/report') {
                reports.push((await request.json()) as Record<string, unknown>);
                return new Response('ok');
            }
            return new Response(
                `<!doctype html><title>Browser fixture</title>
<input autofocus style="position:absolute;left:0;top:0;width:150px;height:30px">
<button style="position:absolute;left:0;top:50px;width:100px;height:30px" onclick="document.title='clicked';report('click')">Click</button>
<main style="width:320px;height:180px;background:#123456"></main>
<script>
const report=event=>fetch('/report',{method:'POST',body:JSON.stringify({event,path:location.pathname,text:document.querySelector('input').value,width:innerWidth,height:innerHeight,dpr:devicePixelRatio})});
addEventListener('resize',()=>report('resize'));
document.querySelector('input').addEventListener('input',()=>report('input'));
report('load');
</script>`,
                { headers: { 'content-type': 'text/html' } }
            );
        }
    });
    const daemon = Bun.spawn(
        [
            join(process.env.HOME ?? '', '.cargo/bin/cargo'),
            'run',
            '--quiet',
            '--manifest-path',
            join(root, 'apps/server-rust/Cargo.toml'),
            '--',
            '--no-hooks',
            '--no-price-fetch',
            '--no-broker',
            '--no-stun',
            '--port',
            '0'
        ],
        { cwd: root, env: { ...process.env, RUIMTE_HOME: home }, stdout: 'pipe', stderr: 'pipe' }
    );
    let socket: WebSocket | undefined;
    let strangerSocket: WebSocket | undefined;
    try {
        const port = await listeningPort(daemon);
        const secret = (await readFile(join(home, 'local.key'), 'utf8')).trim();
        const connection = await connect(port, secret);
        socket = connection.socket;
        const opened = (await connection.rpc('browser.open', {
            browserId: 'browser-integration',
            url: `http://127.0.0.1:${fixture.port}`,
            width: 320,
            height: 180,
            stream: 'events'
        })) as { streamId: string };
        expect(opened.streamId).toStartWith('browser:');
        await connection.waitForStatus((status) => status.title === 'Browser fixture');
        await waitFor(() => reports.some((report) => report.event === 'load' && report.path === '/'), 'page load');

        await connection.rpc('browser.resize', {
            browserId: 'browser-integration',
            width: 400,
            height: 240,
            deviceScaleFactor: 2
        });
        await connection.rpc('browser.input', {
            browserId: 'browser-integration',
            input: { kind: 'text', text: 'café 界' }
        });
        await waitFor(() => reports.some((report) => report.text === 'café 界'), 'DOM text input');
        await waitFor(() => reports.some((report) => report.width === 400 && report.height === 240 && report.dpr === 2), 'viewport and device scale');
        for (const phase of ['down', 'up'] as const) {
            await connection.rpc('browser.input', {
                browserId: 'browser-integration',
                input: { kind: 'pointer', phase, x: 30, y: 65, button: 'left', buttons: phase === 'down' ? 1 : 0 }
            });
        }
        await waitFor(() => reports.some((report) => report.event === 'click'), 'pointer click');
        await connection.rpc('browser.navigate', {
            browserId: 'browser-integration',
            url: `http://127.0.0.1:${fixture.port}/two`
        });
        await waitFor(() => reports.some((report) => report.path === '/two'), 'second page');
        await connection.rpc('browser.command', { browserId: 'browser-integration', command: 'back' });
        await connection.waitForStatus((status) => String(status.url).endsWith('/') && status.canGoForward === true);

        const stranger = await connect(port, secret);
        strangerSocket = stranger.socket;
        await expect(
            stranger.rpc('browser.navigate', {
                browserId: 'browser-integration',
                url: 'about:blank'
            })
        ).rejects.toThrow('browser-not-found');

        await connection.rpc('browser.detach', { browserId: 'browser-integration' });
        await Bun.sleep(300);
        const detachedFrameCount = connection.browserFrameCount();
        await connection.rpc('browser.resize', {
            browserId: 'browser-integration',
            width: 400,
            height: 240,
            deviceScaleFactor: 2
        });
        await Bun.sleep(500);
        expect(connection.browserFrameCount()).toBe(detachedFrameCount);

        const response = await fetch(`http://127.0.0.1:${port}/live-stream/${encodeURIComponent(opened.streamId)}?token=${encodeURIComponent(secret)}`);
        expect(response.status).toBe(200);
        const reader = response.body!.getReader();
        const decoder = new LiveStreamDecoder();
        let sawMagic = false;
        let frameCount = 0;
        let frameSize: [number, number] | undefined;
        const deadline = Date.now() + 15_000;
        while (frameCount === 0 && Date.now() < deadline) {
            const chunk = await Promise.race([reader.read(), Bun.sleep(1000).then(() => null)]);
            if (!chunk || chunk.done) {
                continue;
            }
            if (!sawMagic) {
                expect([...chunk.value.slice(0, LIVE_STREAM_MAGIC.length)]).toEqual([...LIVE_STREAM_MAGIC]);
                sawMagic = true;
            }
            const frames = decoder.push(chunk.value);
            frameCount += frames.length;
            if (frames.length) {
                frameSize = [frames.at(-1)!.width, frames.at(-1)!.height];
            }
        }
        expect(frameCount).toBeGreaterThan(0);
        expect(frameSize).toEqual([800, 480]);

        await connection.rpc('endpoint.setIdentity', { name: null, icon: null, streamingAllowed: false });
        const closed = await Promise.race([reader.read(), Bun.sleep(5000).then(() => null)]);
        expect(closed?.done).toBeTrue();
        await expect(
            connection.rpc('browser.open', {
                browserId: 'browser-integration',
                url: 'https://example.com',
                width: 320,
                height: 180
            })
        ).rejects.toThrow('streaming-disabled');
        await connection.rpc('browser.kill', { browserId: 'browser-integration' });
        await expect(
            connection.rpc('browser.navigate', {
                browserId: 'browser-integration',
                url: 'about:blank'
            })
        ).rejects.toThrow('browser-not-found');
    } finally {
        strangerSocket?.close();
        socket?.close();
        daemon.kill('SIGTERM');
        await Promise.race([daemon.exited, Bun.sleep(5000)]);
        if (daemon.exitCode === null) {
            daemon.kill('SIGKILL');
            await daemon.exited;
        }
        fixture.stop(true);
        await rm(home, { recursive: true, force: true });
    }
}, 90_000);

const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
    const deadline = Date.now() + 8000;
    while (!predicate()) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${label}`);
        }
        await Bun.sleep(20);
    }
};

const listeningPort = async (child: ReturnType<typeof Bun.spawn>): Promise<number> => {
    let output = '';
    let port = 0;
    const inspect = async (stream: ReadableStream): Promise<void> => {
        for await (const chunk of stream) {
            output += new TextDecoder().decode(chunk);
            port ||= Number(/listening on ws:\/\/[^:]+:(\d+)\/ws/.exec(output)?.[1] ?? 0);
        }
    };
    void inspect(child.stdout);
    void inspect(child.stderr);
    const deadline = Date.now() + 30_000;
    while (!port) {
        if (child.exitCode !== null || Date.now() > deadline) {
            throw new Error(`Daemon failed to listen: ${output}`);
        }
        await Bun.sleep(20);
    }
    return port;
};

const connect = async (port: number, token: string) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?protocol=1&token=${encodeURIComponent(token)}`);
    const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    const statuses: Array<Record<string, unknown>> = [];
    let browserFrames = 0;
    let sequence = 0;
    socket.addEventListener('message', (event) => {
        const frame = JSON.parse(String(event.data)) as any;
        if (frame.type === 'event') {
            EVENT_SCHEMAS[frame.event as keyof typeof EVENT_SCHEMAS]?.parse(frame.payload);
            if (frame.event === 'browser.status') {
                statuses.push(frame.payload);
            } else if (frame.event === 'browser.frame') {
                browserFrames += 1;
            }
            return;
        }
        const request = pending.get(frame.id);
        if (!request) {
            return;
        }
        pending.delete(frame.id);
        if (frame.ok) {
            request.resolve(frame.result);
        } else {
            request.reject(new Error(`${frame.error?.code}: ${frame.error?.message}`));
        }
    });
    await new Promise<void>((resolveOpen, reject) => {
        socket.addEventListener('open', () => resolveOpen(), { once: true });
        socket.addEventListener('error', () => reject(new Error('WebSocket failed')), { once: true });
    });
    const rpc = async (method: keyof typeof REQUEST_SCHEMAS, payload: unknown): Promise<unknown> => {
        const id = String(++sequence);
        const result = await new Promise<unknown>((resolveReply, reject) => {
            pending.set(id, { resolve: resolveReply, reject });
            socket.send(JSON.stringify({ id, type: method, payload }));
        });
        REQUEST_SCHEMAS[method].result.parse(result);
        return result;
    };
    const waitForStatus = async (matches: (status: Record<string, unknown>) => boolean): Promise<void> => {
        const deadline = Date.now() + 15_000;
        while (!statuses.some(matches) && Date.now() < deadline) {
            await Bun.sleep(20);
        }
        if (!statuses.some(matches)) {
            throw new Error(`Browser status did not arrive: ${JSON.stringify(statuses)}`);
        }
    };
    return { socket, rpc, waitForStatus, browserFrameCount: () => browserFrames };
};
