import type { Subprocess } from 'bun';
import { rm } from 'node:fs/promises';
import { cpus, release, tmpdir, totalmem } from 'node:os';
import { parseArgs } from 'node:util';
import { ManualClock } from '@adecore/agents/testing';
import { PROTOCOL_VERSION, type ProjectContent } from '@ruimte/contracts';
import { AuthStore } from '../src/auth/auth-store.ts';
import { Handshake } from '../src/auth/handshake.ts';
import { generateKeyPair, signMessage } from '../src/auth/keys.ts';
import { SOCKET_BACKPRESSURE_LIMIT } from '../src/backpressure.ts';
import { connectionOpener, socketChannel, type ClientChannel, type ConnectionServices, type SocketChannel } from '../src/connection.ts';
import { BunPtyAdapter } from '../src/pty/bun-pty.ts';
import { authenticateChannel } from '../src/pulsar/channel-auth.ts';
import { AUTHENTICATED_FRAME_CHARS } from '../src/pulsar/data-channel.ts';
import { DirectClient } from '../src/pulsar/direct-client.ts';
import { DirectPeers } from '../src/pulsar/peers.ts';
import { bootTestDaemon, releasedProject } from '../src/tasks/test-daemon.ts';
import type { ClientAccess } from '../src/wire.ts';
import { renderReport, type Channel, type ChannelRun, type Environment, type PhaseData, type Run } from './latency-report.ts';

/*
 * How long a client waits for a reply, for a key echoed by a quiet terminal and for the first word of
 * a chat, while another terminal prints as fast as it can. The daemon and the measuring client run in
 * two processes, so the client does not share the daemon's event loop.
 *
 *   bun apps/server/scripts/measure-latency.ts --channel both --seconds 30 --out latency.json > latency.md
 *
 * The daemon is the real wiring over real terminals and the in-process fake Claude. The direct channel
 * is werift on both ends over loopback, which measures the daemon's side of it and not a network.
 */

const DAEMON_ID = 'daemon-latency';
const LOCAL_SECRET = 'the-local-secret-of-the-latency-run';
const CHAT_ID = 'chat-measure';
const COLS = 120;
const ROWS = 30;
// A probe that gets no answer in this long counts as this many milliseconds, so a stalled channel shows as a number.
const PROBE_TIMEOUT_MS = 5_000;
const LAG_SAMPLE_MS = 50;
const DEFAULT_BUSY = 'yes "$(printf \'%0200d\' 0)"';

type ParentMessage = { type: 'signal'; envelope: unknown } | { type: 'phase'; name: string } | { type: 'report' } | { type: 'stop' };

type ChildMessage =
    | { type: 'ready'; port: number }
    | { type: 'signal'; envelope: unknown }
    | { type: 'report'; lag: number[]; pauses: Record<Channel, number> };

function post(message: ChildMessage): void {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

/* The daemon: the real wiring on real terminals, behind a socket and a direct channel. */
async function serve(): Promise<void> {
    const content: ProjectContent = {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [{ id: CHAT_ID, kind: 'chat', title: 'Chat', x: 0, y: 0, w: 480, h: 520, provider: 'claude' }],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    };
    const { root, home, folder, store } = await releasedProject('ruimte-latency-', content);
    const daemon = await bootTestDaemon({ home, store, clock: new ManualClock(), ptyAdapter: new BunPtyAdapter() });
    daemon.worker.start();
    await daemon.chats.create({ chatId: CHAT_ID, provider: 'claude', cwd: folder });

    const noSource = { subscribe: () => () => undefined, detachAll: () => undefined };
    const services: ConnectionServices = {
        dispatcher: daemon.dispatcher,
        sessions: daemon.sessions,
        chats: daemon.chats,
        identity: noSource,
        projects: noSource,
        drawings: noSource,
        diagrams: noSource,
        folders: noSource,
        statuses: noSource,
        usage: noSource,
        limits: noSource,
        processes: noSource
    };
    const openConnection = connectionOpener(services);

    const pauses: Record<Channel, number> = { socket: 0, direct: 0 };
    /* Counts the sends the channel answered with backpressure or a drop: where the output gate stops streaming. */
    const counted = (channel: ClientChannel, name: Channel): ClientChannel => ({
        send: (data) => {
            const status = channel.send(data);
            if (status <= 0) {
                pauses[name]++;
            }
            return status;
        },
        bufferedAmount: () => channel.bufferedAmount(),
        close: (code, reason) => channel.close(code, reason),
        onClose: (listener) => channel.onClose(listener),
        onDrain: (listener) => channel.onDrain(listener),
        outputShare: channel.outputShare
    });

    const authStore = new AuthStore(home);
    const key = generateKeyPair();
    const handshake = new Handshake(authStore, { id: DAEMON_ID, publicKey: key.publicKey, sign: (message) => signMessage(key.privateKey, message) });
    const peers = new DirectPeers({
        iceServers: () => [],
        portRange: null,
        hostAddresses: [],
        attemptTimeoutMs: 20_000,
        log: { log: () => undefined, warn: (...parts: unknown[]) => console.error(...parts) },
        authenticate: (channel, binding) =>
            authenticateChannel({ channel, binding, handshake, daemonId: DAEMON_ID, localSecret: LOCAL_SECRET, reachability: 'lan', timeoutMs: 10_000 }),
        open: (channel, access) => {
            const connection = openConnection(counted(channel, 'direct'), access);
            channel.receiveWith((frame) => connection.receive(frame), AUTHENTICATED_FRAME_CHARS);
        }
    });

    const sockets = new Map<object, { channel: SocketChannel; receive(frame: string | Uint8Array | Buffer): void }>();
    const server = Bun.serve<ClientAccess>({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request, upgrading) {
            if (upgrading.upgrade(request, { data: { reachability: 'loopback', sessionId: null } })) {
                return undefined;
            }
            return new Response('Expected a WebSocket upgrade', { status: 426 });
        },
        websocket: {
            backpressureLimit: SOCKET_BACKPRESSURE_LIMIT,
            closeOnBackpressureLimit: true,
            open(ws) {
                const channel = socketChannel(ws);
                const connection = openConnection(counted(channel, 'socket'), ws.data);
                sockets.set(ws, { channel, receive: (frame) => connection.receive(frame) });
            },
            drain(ws) {
                sockets.get(ws)?.channel.drained();
            },
            message(ws, message) {
                sockets.get(ws)?.receive(message);
            },
            close(ws) {
                sockets.get(ws)?.channel.closed();
                sockets.delete(ws);
            }
        }
    });

    let lag: number[] = [];
    let last = performance.now();
    const sampler = setInterval(() => {
        const now = performance.now();
        lag.push(Math.max(0, now - last - LAG_SAMPLE_MS));
        last = now;
    }, LAG_SAMPLE_MS);

    post({ type: 'ready', port: server.port ?? 0 });
    for await (const line of console) {
        if (line.trim() === '') {
            continue;
        }
        const message = JSON.parse(line) as ParentMessage;
        if (message.type === 'signal') {
            peers.receive(message.envelope as never, (reply) => post({ type: 'signal', envelope: reply }));
        } else if (message.type === 'phase') {
            lag = [];
            pauses.socket = 0;
            pauses.direct = 0;
        } else if (message.type === 'report') {
            post({ type: 'report', lag, pauses: { ...pauses } });
        } else if (message.type === 'stop') {
            break;
        }
    }
    clearInterval(sampler);
    peers.closeAll();
    await server.stop(true);
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
    process.exit(0);
}

interface Link {
    request(type: string, payload: unknown): Promise<unknown>;
    onEvent(listener: (event: string, payload: Record<string, unknown>) => void): void;
    close(): void;
}

function parseFrame(raw: string): {
    id?: string | null;
    ok?: boolean;
    result?: unknown;
    error?: { code: string; message: string };
    event?: string;
    payload?: Record<string, unknown>;
} {
    return JSON.parse(raw);
}

function socketLink(port: number): Promise<Link> {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
        const listeners: Array<(event: string, payload: Record<string, unknown>) => void> = [];
        let nextId = 1;
        socket.onmessage = (message) => {
            const frame = parseFrame(String(message.data));
            if (frame.event !== undefined) {
                for (const listener of listeners) {
                    listener(frame.event, frame.payload ?? {});
                }
                return;
            }
            const waiter = frame.id === null || frame.id === undefined ? undefined : pending.get(frame.id);
            if (waiter && frame.id) {
                pending.delete(frame.id);
                if (frame.ok) {
                    waiter.resolve(frame.result);
                } else {
                    waiter.reject(new Error(`${frame.error?.code}: ${frame.error?.message}`));
                }
            }
        };
        socket.onerror = () => reject(new Error('Could not connect to the daemon'));
        socket.onopen = () =>
            resolve({
                request: (type, payload) =>
                    new Promise((done, fail) => {
                        const id = String(nextId++);
                        pending.set(id, { resolve: done, reject: fail });
                        socket.send(JSON.stringify({ id, type, payload }));
                    }),
                onEvent: (listener) => listeners.push(listener),
                close: () => socket.close()
            });
    });
}

async function directLink(send: (message: ParentMessage) => void, signals: { deliver?: (envelope: never) => void }): Promise<Link> {
    const client: DirectClient = new DirectClient({
        stunServers: [],
        credential: { kind: 'secret', secret: LOCAL_SECRET, daemonId: DAEMON_ID },
        timeoutMs: 30_000,
        signal: (envelope) => send({ type: 'signal', envelope })
    });
    signals.deliver = (envelope) => client.receiveSignal(envelope);
    await client.open();
    return {
        request: (type, payload) => client.request(type, payload),
        onEvent: (listener) =>
            client.onFrame((raw) => {
                const frame = parseFrame(raw);
                if (frame.event !== undefined) {
                    listener(frame.event, frame.payload ?? {});
                }
            }),
        close: () => client.close()
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Options {
    channels: Channel[];
    seconds: number;
    warmup: number;
    busy: string;
    replyMs: number;
    quietMs: number;
    chatMs: number;
}

/* One probe loop: `once` runs one probe and answers its latency; the loop keeps its pace and records into whatever `into` points at now. */
function probeLoop(intervalMs: number, once: () => Promise<number>, into: () => number[] | null, stopped: () => boolean): Promise<void> {
    return (async () => {
        while (!stopped()) {
            const started = performance.now();
            const latency = await once();
            into()?.push(latency);
            await sleep(Math.max(0, intervalMs - (performance.now() - started)));
        }
    })();
}

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
    return Promise.race([promise, sleep(PROBE_TIMEOUT_MS).then(() => fallback)]);
}

function emptyPhase(seconds: number): PhaseData {
    return { seconds, reply: [], quiet: [], chat: [], lag: [], busyBytes: 0, busyFrames: 0, resyncs: 0, pauses: 0 };
}

async function measureChannel(
    channel: Channel,
    link: Link,
    options: Options,
    child: { phase(name: string): void; report(): Promise<{ lag: number[]; pauses: Record<Channel, number> }> }
): Promise<ChannelRun> {
    const busyId = `busy-${channel}`;
    const quietId = `quiet-${channel}`;
    let current: PhaseData | null = null;
    let warm: PhaseData | null = emptyPhase(options.warmup);
    const phaseOf = (): PhaseData | null => current ?? warm;

    const quietWaiters = new Map<string, () => void>();
    let chatWaiter: (() => void) | null = null;
    link.onEvent((event, payload) => {
        if (event === 'session.output') {
            const data = String(payload.data ?? '');
            if (payload.sessionId === busyId) {
                const phase = phaseOf();
                if (phase) {
                    phase.busyBytes += data.length;
                    phase.busyFrames += 1;
                }
            } else if (payload.sessionId === quietId) {
                for (const [token, done] of quietWaiters) {
                    if (data.includes(token)) {
                        quietWaiters.delete(token);
                        done();
                    }
                }
            }
        } else if (event === 'session.resync') {
            const phase = phaseOf();
            if (phase) {
                phase.resyncs += 1;
            }
        } else if (event === 'chat.event' && payload.chatId === CHAT_ID) {
            chatWaiter?.();
        }
    });

    for (const sessionId of [busyId, quietId]) {
        await link.request('session.create', { sessionId, cols: COLS, rows: ROWS, shell: '/bin/sh', cwd: tmpdir() });
        await link.request('session.attach', { sessionId, cols: COLS, rows: ROWS });
    }
    await link.request('session.write', { sessionId: quietId, data: 'cat\n' });
    await link.request('chat.attach', { chatId: CHAT_ID });

    let stopped = false;
    let tokens = 0;
    let turns = 0;
    const loops = [
        probeLoop(
            options.replyMs,
            async () => {
                const started = performance.now();
                await withTimeout(link.request('server.ping', {}), null);
                return performance.now() - started;
            },
            () => phaseOf()?.reply ?? null,
            () => stopped
        ),
        probeLoop(
            options.quietMs,
            async () => {
                const token = `q${tokens++}`;
                const started = performance.now();
                const echoed = new Promise<void>((resolve) => quietWaiters.set(token, resolve));
                await link.request('session.write', { sessionId: quietId, data: `${token}\n` });
                await withTimeout(echoed, undefined);
                quietWaiters.delete(token);
                return performance.now() - started;
            },
            () => phaseOf()?.quiet ?? null,
            () => stopped
        ),
        probeLoop(
            options.chatMs,
            async () => {
                const started = performance.now();
                const first = new Promise<void>((resolve) => {
                    chatWaiter = resolve;
                });
                await link.request('chat.send', { chatId: CHAT_ID, text: `ping ${turns++}` });
                await withTimeout(first, undefined);
                chatWaiter = null;
                return performance.now() - started;
            },
            () => phaseOf()?.chat ?? null,
            () => stopped
        )
    ];

    console.error(`[${channel}] warm-up ${options.warmup} s`);
    await sleep(options.warmup * 1000);
    warm = null;

    const run = async (name: 'idle' | 'busy'): Promise<PhaseData> => {
        const phase = emptyPhase(options.seconds);
        current = phase;
        child.phase(name);
        if (name === 'busy') {
            await link.request('session.write', { sessionId: busyId, data: `${options.busy}\n` });
        }
        console.error(`[${channel}] ${name} ${options.seconds} s`);
        const started = performance.now();
        await sleep(options.seconds * 1000);
        phase.seconds = (performance.now() - started) / 1000;
        current = null;
        if (name === 'busy') {
            await link.request('session.write', { sessionId: busyId, data: '\x03' }).catch(() => undefined);
        }
        const report = await child.report();
        phase.lag = report.lag;
        phase.pauses = report.pauses[channel];
        return phase;
    };
    const idle = await run('idle');
    const busy = await run('busy');
    stopped = true;
    await Promise.all(loops);
    for (const sessionId of [busyId, quietId]) {
        await link.request('session.kill', { sessionId }).catch(() => undefined);
    }
    return { channel, idle, busy };
}

async function shell(command: string[]): Promise<string | null> {
    try {
        const process = Bun.spawn(command, { stdout: 'pipe', stderr: 'ignore' });
        const text = (await new Response(process.stdout).text()).trim();
        return (await process.exited) === 0 ? text : null;
    } catch {
        return null;
    }
}

async function environmentOf(): Promise<Environment> {
    const agents = (await Bun.file(require.resolve('@adecore/agents/package.json')).json()) as { version: string };
    const dirty = ((await shell(['git', 'status', '--porcelain'])) ?? '') !== '';
    return {
        date: new Date().toISOString(),
        commit: (await shell(['git', 'rev-parse', 'HEAD'])) ?? 'unknown',
        dirty,
        bun: Bun.version,
        version: process.env.RUIMTE_VERSION ?? 'unset',
        build: process.env.RUIMTE_BUILD || null,
        protocol: PROTOCOL_VERSION,
        agents: agents.version,
        cpu: cpus()[0]?.model ?? 'unknown',
        cores: cpus().length,
        memoryGiB: Math.round(totalmem() / 1024 ** 3),
        os: `${process.platform} ${release()}`,
        model: await shell(['sysctl', '-n', 'hw.model']),
        power: ((await shell(['pmset', '-g', 'batt'])) ?? '').split('\n')[0] || null
    };
}

async function measure(): Promise<void> {
    const { values } = parseArgs({
        args: process.argv.slice(2),
        options: {
            channel: { type: 'string', default: 'socket' },
            seconds: { type: 'string', default: '30' },
            warmup: { type: 'string', default: '5' },
            busy: { type: 'string', default: DEFAULT_BUSY },
            out: { type: 'string' }
        },
        strict: true
    });
    if (!['socket', 'direct', 'both'].includes(values.channel!)) {
        throw new Error('--channel is socket, direct or both');
    }
    const options: Options = {
        channels: values.channel === 'both' ? ['socket', 'direct'] : [values.channel as Channel],
        seconds: Number(values.seconds),
        warmup: Number(values.warmup),
        busy: values.busy!,
        replyMs: 50,
        quietMs: 250,
        chatMs: 2000
    };

    const child: Subprocess<'pipe', 'pipe', 'inherit'> = Bun.spawn([process.execPath, import.meta.path, 'serve'], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'inherit'
    });
    const send = (message: ParentMessage): void => {
        child.stdin.write(`${JSON.stringify(message)}\n`);
        void child.stdin.flush();
    };
    const signals: { deliver?: (envelope: never) => void } = {};
    let ready: (port: number) => void = () => undefined;
    const port = new Promise<number>((resolve) => {
        ready = resolve;
    });
    // Set by the wait below; declared through `as` so the reader above keeps the wide type.
    let reported = null as ((report: { lag: number[]; pauses: Record<Channel, number> }) => void) | null;
    void (async () => {
        const decoder = new TextDecoder();
        let buffered = '';
        for await (const chunk of child.stdout) {
            buffered += decoder.decode(chunk, { stream: true });
            for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
                const line = buffered.slice(0, at);
                buffered = buffered.slice(at + 1);
                const message = JSON.parse(line) as ChildMessage;
                if (message.type === 'ready') {
                    ready(message.port);
                } else if (message.type === 'signal') {
                    signals.deliver?.(message.envelope as never);
                } else if (message.type === 'report') {
                    reported?.(message);
                }
            }
        }
    })();

    const controls = {
        phase: (name: string) => send({ type: 'phase', name }),
        report: () =>
            new Promise<{ lag: number[]; pauses: Record<Channel, number> }>((resolve) => {
                reported = resolve;
                send({ type: 'report' });
            })
    };

    const results: ChannelRun[] = [];
    try {
        const daemonPort = await port;
        for (const channel of options.channels) {
            const link = channel === 'socket' ? await socketLink(daemonPort) : await directLink(send, signals);
            try {
                results.push(await measureChannel(channel, link, options, controls));
            } finally {
                link.close();
            }
        }
    } finally {
        send({ type: 'stop' });
        await Promise.race([child.exited, sleep(10_000)]);
        child.kill();
    }

    const run: Run = {
        fixture: {
            busyCommand: options.busy,
            replyIntervalMs: options.replyMs,
            quietIntervalMs: options.quietMs,
            chatIntervalMs: options.chatMs,
            warmupSeconds: options.warmup,
            seconds: options.seconds,
            channels: options.channels
        },
        channels: results
    };
    if (values.out) {
        await Bun.write(values.out, JSON.stringify(run, null, 2));
    }
    process.stdout.write(`${renderReport(run, await environmentOf())}\n`);
    process.exit(0);
}

if (import.meta.main) {
    await (process.argv[2] === 'serve' ? serve() : measure());
}
