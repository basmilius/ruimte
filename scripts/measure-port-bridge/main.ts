import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer as createHttp } from 'node:http';
import { createServer as createNet, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IpcRelay } from '../../apps/desktop/src/port-tunnel/ipc-relay.ts';
import { parseToShell, parseTunnelRequest } from '../../apps/desktop/src/port-tunnel/messages.ts';
import { tunnelDestinationAllowed } from '../../apps/desktop/src/port-tunnel/tunnel-policy.ts';
import { installPortTunnels } from '../../apps/desktop/src/port-tunnel/tunnel-session.ts';
import { hardenGuestPreferences } from '../../apps/desktop/src/web-guards.ts';
import { ResponseDecoder } from './http-response.ts';

/*
 * The measurement of how the pages of a shared port reach the machine on the desktop: the same fake site and the
 * same machine connection through (a) no tunnel, (b) the session proxy and fixed IPC messages of
 * `apps/desktop/src/port-tunnel`, and (c) `session.protocol.handle('http')` on a session of its own, which has no
 * listener. This file is the Electron main process; `run.ts` starts it.
 */

// A plain require: the bundler's ESM interop copies enumerable keys, and electron's are getters.
const { app, BrowserWindow, ipcMain, session } = require('electron') as typeof import('electron');

const RUNS = Number(process.env.RUNS ?? 3);
const RESULT_FILE = process.env.RESULT_FILE ?? join(tmpdir(), 'port-bridge-result.json');
const MACHINE_URL = process.env.MACHINE_URL ?? '';
const HERE = process.env.HARNESS_DIR ?? __dirname;
const SMALL_BYTES = 1024;
const BIG_MB = Number(process.env.BIG_MB ?? 8);

const PAGE = `<!doctype html><title>measure</title><script>
(async () => {
    const r = {};
    const nav = performance.getEntriesByType('navigation')[0];
    r.ttfbMs = Math.round(nav.responseStart);
    const pool = async (count, width, task) => {
        let next = 0;
        await Promise.all(Array.from({ length: width }, async () => { while (next < count) { await task(next++); } }));
    };
    let start = performance.now();
    await pool(200, 6, (i) => fetch('/small/' + i, { cache: 'no-store' }).then((x) => x.arrayBuffer()));
    r.smallMs = Math.round(performance.now() - start);
    start = performance.now();
    const big = await (await fetch('/big?mb=${BIG_MB}', { cache: 'no-store' })).arrayBuffer();
    r.bigMs = Math.round(performance.now() - start);
    r.bigBytes = big.byteLength;
    start = performance.now();
    const up = await (await fetch('/up', { method: 'POST', body: new Uint8Array(2 * 1024 * 1024) })).json();
    r.upMs = Math.round(performance.now() - start);
    r.upBytes = up.bytes;
    r.siteAuthStatus = (await fetch('/protected', { cache: 'no-store' })).status;
    r.proxyHeadersSeenBySite = (await (await fetch('/seen', { cache: 'no-store' })).json()).proxyHeaders;
    start = performance.now();
    r.ws = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve('timeout'), 5000);
        const socket = new WebSocket('ws://' + location.host + '/ws');
        socket.onmessage = () => { clearTimeout(timer); resolve(Math.round(performance.now() - start)); };
        socket.onerror = () => { clearTimeout(timer); resolve('error'); };
    });
    document.title = 'RESULT:' + JSON.stringify(r);
})().catch((e) => { document.title = 'RESULT:' + JSON.stringify({ error: String(e) }); });
</script>`;

/* A site on ::1 with the traffic of a development server: a page, small assets, a large bundle, an upload and a WebSocket. */
async function startSite(): Promise<{ port: number; stop(): void }> {
    let proxyHeaders = 0;
    const server = createHttp((request, response) => {
        const url = new URL(request.url ?? '/', 'http://site');

        if (Object.keys(request.headers).some((name) => name.startsWith('proxy-')) || String(request.headers.authorization ?? '').includes('ruimte')) {
            proxyHeaders += 1;
        }
        const headers = { 'cache-control': 'no-store', 'content-type': 'application/octet-stream' };

        if (url.pathname === '/') {
            response.writeHead(200, { ...headers, 'content-type': 'text/html' });
            response.end(PAGE);
        } else if (url.pathname.startsWith('/small/')) {
            response.writeHead(200, { ...headers, 'content-length': SMALL_BYTES });
            response.end(Buffer.alloc(SMALL_BYTES, 97));
        } else if (url.pathname === '/big') {
            const total = Number(url.searchParams.get('mb') ?? 1) * 1024 * 1024;
            let sent = 0;

            response.writeHead(200, { ...headers, 'content-length': total });

            const push = (): void => {
                while (sent < total) {
                    const piece = Buffer.alloc(Math.min(65536, total - sent), 98);

                    sent += piece.length;

                    if (!response.write(piece)) {
                        response.once('drain', push);

                        return;
                    }
                }

                response.end();
            };

            push();
        } else if (url.pathname === '/protected') {
            // The site's own 401: a login for this must never be answered with the proxy's secret.
            response.writeHead(401, { ...headers, 'www-authenticate': 'Basic realm="site"', 'content-length': 0 });
            response.end();
        } else if (url.pathname === '/seen') {
            response.writeHead(200, { ...headers, 'content-type': 'application/json' });
            response.end(JSON.stringify({ proxyHeaders }));
        } else if (url.pathname === '/up') {
            let bytes = 0;

            request.on('data', (chunk: Buffer) => (bytes += chunk.length));
            request.on('end', () => {
                response.writeHead(200, { ...headers, 'content-type': 'application/json' });
                response.end(JSON.stringify({ bytes }));
            });
        } else {
            response.writeHead(404).end();
        }
    });

    server.on('upgrade', (request, socket) => {
        const key = String(request.headers['sec-websocket-key']);
        const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');

        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        socket.write(Buffer.from([0x81, 0x05, ...Buffer.from('hello')]));
        socket.on('data', () => undefined);
        socket.on('error', () => undefined);
    });

    await new Promise<void>((resolve) => server.listen({ host: '::1', port: 0 }, () => resolve()));

    return { port: (server.address() as { port: number }).port, stop: () => server.close() };
}

/* This computer's own loopback on the same port: whatever a page reaches here instead of the tunnel is a leak. */
async function startDecoy(port: number): Promise<{ hits(): number; stop(): void }> {
    let hits = 0;
    const server: Server = createNet((socket) => {
        hits += 1;
        socket.on('error', () => undefined);
        socket.destroy();
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host: '127.0.0.1', port }, () => resolve());
    });

    return { hits: () => hits, stop: () => server.close() };
}

/* The listener-free variant: a request of the page becomes bytes on a stream of the machine and the answer becomes a `Response`. */
async function answerThroughStream(relay: IpcRelay, request: Request): Promise<Response> {
    const url = new URL(request.url);
    const body = request.body;
    const length = request.headers.get('content-length');
    const lines = [`${request.method} ${url.pathname}${url.search} HTTP/1.1`, `Host: ${url.host}`, 'Connection: close'];

    for (const [name, value] of request.headers) {
        if (!['host', 'connection', 'content-length', 'transfer-encoding', 'proxy-connection'].includes(name)) {
            lines.push(`${name}: ${value}`);
        }
    }

    if (body !== null) {
        lines.push(length === null ? 'Transfer-Encoding: chunked' : `Content-Length: ${length}`);
    }

    let wake: (() => void) | null = null;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let resolveHead!: (response: Response) => void;
    let failHead!: (error: Error) => void;
    let settled = false;
    const head = new Promise<Response>((resolve, reject) => {
        resolveHead = resolve;
        failHead = reject;
    });
    const payload = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
    const decoder = new ResponseDecoder(
        (parsed) => {
            settled = true;
            resolveHead(new Response(payload, { status: parsed.status, statusText: parsed.statusText, headers: parsed.headers }));
        },
        (bytes) => controller.enqueue(new Uint8Array(bytes)),
        () => {
            controller.close();
            stream.close();
        }
    );
    const stream = await relay.open({
        data: (bytes, consumed) => {
            decoder.feed(bytes);
            consumed();
        },
        drain: () => wake?.(),
        end: (reason) => {
            decoder.end();

            if (!settled) {
                failHead(new Error(reason ?? 'The machine closed before it answered'));
            }
        }
    });
    const send = async (bytes: Uint8Array): Promise<void> => {
        if (!stream.write(bytes)) {
            await new Promise<void>((resolve) => (wake = resolve));
        }
    };

    await send(Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'latin1'));

    if (body !== null) {
        void (async () => {
            const reader = body.getReader();

            for (let part = await reader.read(); !part.done; part = await reader.read()) {
                await send(
                    length === null ? Buffer.concat([Buffer.from(`${part.value.length.toString(16)}\r\n`), part.value, Buffer.from('\r\n')]) : part.value
                );
            }

            if (length === null) {
                await send(Buffer.from('0\r\n\r\n'));
            }
        })();
    }

    return head;
}

interface Sample {
    peakMainRssMb: number;
    peakAllWorkingSetMb: number;
}

/* Samples this process and every process of the app while a scenario runs. */
function sampler(): { stop(): Sample } {
    let main = 0;
    let all = 0;
    const timer = setInterval(() => {
        main = Math.max(main, process.memoryUsage().rss);
        all = Math.max(
            all,
            app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize * 1024, 0)
        );
    }, 25);

    return {
        stop: () => {
            clearInterval(timer);

            return { peakMainRssMb: Math.round(main / 1048576), peakAllWorkingSetMb: Math.round(all / 1048576) };
        }
    };
}

void app.whenReady().then(async () => {
    const guestPreload = join(tmpdir(), 'port-bridge-empty-guest.cjs');
    const site = await startSite();
    const decoy = await startDecoy(site.port);
    const relayWindow = new BrowserWindow({
        show: false,
        webPreferences: {
            preload: join(HERE, 'preload.cjs'),
            webviewTag: true,
            contextIsolation: true,
            sandbox: true,
            additionalArguments: [`--machine=${MACHINE_URL}`]
        }
    });
    const contents = relayWindow.webContents;
    const isAppSender = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean => event.sender === contents;
    const tunnels = installPortTunnels(isAppSender, guestPreload);
    const protocolRelays = new Map<string, IpcRelay>();

    writeFileSync(guestPreload, '');

    contents.on('will-attach-webview', (event, preferences) => {
        const own = hardenGuestPreferences(preferences, (partition) => tunnels.owns(contents, partition));
        const harness = (preferences.partition ?? '').startsWith('baseline-') || (preferences.partition ?? '').startsWith('protocol-');

        if (!own && !harness) {
            event.preventDefault();
        }
    });

    ipcMain.handle('harness:open-protocol', (event, value: unknown) => {
        const request = parseTunnelRequest(value);

        if (!isAppSender(event) || request === null) {
            return null;
        }

        const id = randomUUID();
        const partition = `protocol-${id}`;
        const relay = new IpcRelay(id, (message) => contents.send('port-tunnel:message', message));

        protocolRelays.set(id, relay);
        session
            .fromPartition(partition)
            .protocol.handle('http', (httpRequest) =>
                tunnelDestinationAllowed(httpRequest.url, request.port)
                    ? answerThroughStream(relay, httpRequest).catch((e: unknown) => new Response(String(e), { status: 502 }))
                    : new Response('That address is not shared', { status: 403 })
            );

        return { id, partition };
    });
    ipcMain.on('port-tunnel:send', (event, value: unknown) => {
        const message = parseToShell(value);

        if (message !== null && isAppSender(event)) {
            protocolRelays.get(message.id)?.receive(message);
        }
    });
    ipcMain.on('harness:ipc-echo', (_event, bytes: Uint8Array) => contents.send('harness:ipc-echo', bytes));
    ipcMain.on('harness:close', (_event, id: string) => {
        protocolRelays.get(id)?.closeAll('measurement over');
        protocolRelays.delete(id);
    });

    await contents.loadFile(join(HERE, 'relay.html'));

    const results: Array<Record<string, unknown>> = [];

    for (const kind of (process.env.KINDS ?? 'baseline,bridge,protocol').split(',') as Array<'baseline' | 'bridge' | 'protocol'>) {
        for (let run = 1; run <= RUNS; run += 1) {
            const sampling = sampler();
            const before = decoy.hits();
            const started = Date.now();
            let outcome: unknown;

            try {
                outcome = await contents.executeJavaScript(`window.runScenario(${JSON.stringify({ kind, sitePort: site.port, run })})`);
            } catch (e) {
                outcome = { error: String(e) };
            }

            results.push({ kind, run, wallMs: Date.now() - started, leakedToLocalLoopback: decoy.hits() - before, ...sampling.stop(), ...(outcome as object) });
        }
    }

    results.push({ kind: 'ipc-only', ...((await contents.executeJavaScript('window.runIpc()')) as object) });
    writeFileSync(RESULT_FILE, JSON.stringify(results, null, 2));
    site.stop();
    decoy.stop();
    app.quit();
});

app.on('window-all-closed', () => undefined);
