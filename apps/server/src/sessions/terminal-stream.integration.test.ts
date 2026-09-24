import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Terminal } from '@xterm/headless';
import { EVENT_SCHEMAS, REQUEST_SCHEMAS, parseServerFrame, type RequestMap, type RequestType } from '@ruimte/contracts';
import type { Server, ServerWebSocket } from 'bun';
import { SOCKET_BACKPRESSURE_LIMIT } from '../backpressure.ts';
import { connectionOpener, socketChannel, type ConnectionServices, type OpenConnection, type SocketChannel } from '../connection.ts';
import { Dispatcher, type ClientAccess } from '../dispatcher.ts';
import { registerSessionHandlers } from '../handlers/session.ts';
import { BunPtyAdapter } from '../pty/bun-pty.ts';
import { SessionManager } from './manager.ts';
import { waitFor } from './test-helpers.ts';

/*
 * What a person sees in a terminal, proven end to end: a real shell in a real PTY, the session
 * layer, the output gate and a real WebSocket, with the client's side replayed into an emulator.
 * Every screen a client gets (the attach reply, a resync) starts a segment, the way the client
 * resets its terminal for it; each segment has to read as one unbroken run of the numbers `seq`
 * printed, and the last one has to end on the last number.
 */

const COLS = 40;
const ROWS = 24;
const LAST = 200_000;
// The kernel takes megabytes into a loopback socket before Bun holds a byte itself, so a reader
// that falls behind needs a burst well past what the kernel's buffers can hide. One short of a
// million, since the `seq` of macOS prints a million as 1e+06.
const SLOW_LAST = 999_999;
const END = 'end-of-run';
// Far enough in that a screen holds output, early enough that most of the burst is still to come.
const MID_BURST = '\r\n20000\r\n';
// Output is replayed a chunk at a time and each chunk's finished lines are read off before the
// next, so every line of a million-line burst is checked in the memory of one screen.
const REPLAY_CHUNK = 64 * 1024;
const REPLAY_SCROLLBACK = 50_000;
// Only for the shell's run: a million lines through a PTY take seconds on a loaded CI machine.
const SHELL_RUN_MS = 60_000;

// The quotes keep the echo of the typed line from reading as the end.
const burst = (last: number): string => `seq 1 ${last}; echo end-of-""run; exit\n`;

interface Segment {
    screen: string;
    output: string[];
    // Per text looked for, how many output chunks are known not to hold it.
    searched: Map<string, number>;
}

interface Link {
    send(text: string): void;
    close(): void;
}

interface PausableLink extends Link {
    pause(): void;
    resume(): void;
}

interface LinkEvents {
    receive(text: string): void;
    closed(): void;
}

interface Pending {
    resolve(result: unknown): void;
    reject(error: Error): void;
    // Runs as the reply is read, before any frame after it, so a screen starts its segment in wire order.
    onReply?(result: unknown): void;
}

const segmentShows = (segment: Segment, text: string): boolean => {
    if (segment.screen.includes(text)) {
        return true;
    }
    let chunk = segment.searched.get(text) ?? 0;
    for (; chunk < segment.output.length; chunk++) {
        const carried = chunk > 0 ? segment.output[chunk - 1]!.slice(-(text.length - 1)) : '';
        if ((carried + segment.output[chunk]!).includes(text)) {
            return true;
        }
    }
    segment.searched.set(text, chunk);
    return false;
};

/* One client of the daemon: requests and replies by id, and every screen and output of a session in the order they came. */
class WireClient {
    closed = false;
    private link: Link | null = null;
    private nextId = 1;
    private readonly pending = new Map<string, Pending>();
    private readonly sessions = new Map<string, Segment[]>();
    private waiters: Array<{ check: () => boolean; resolve: () => void }> = [];
    private closeWaiters: Array<() => void> = [];

    events(): LinkEvents {
        return { receive: (text) => this.receive(text), closed: () => this.handleClosed() };
    }

    bind(link: Link): void {
        this.link = link;
    }

    request<T extends RequestType>(
        type: T,
        payload: RequestMap[T]['payload'],
        onReply?: (result: RequestMap[T]['result']) => void
    ): Promise<RequestMap[T]['result']> {
        const id = String(this.nextId++);
        return new Promise((resolve, reject) => {
            this.pending.set(id, {
                resolve: (result) => resolve(REQUEST_SCHEMAS[type].result.parse(result) as RequestMap[T]['result']),
                reject,
                ...(onReply ? { onReply: (result: unknown) => onReply(result as RequestMap[T]['result']) } : {})
            });
            this.link?.send(JSON.stringify({ id, type, payload }));
        });
    }

    async attach(sessionId: string): Promise<void> {
        await this.request('session.attach', { sessionId, cols: COLS, rows: ROWS }, (result) => this.startSegment(sessionId, result.screen));
    }

    segments(sessionId: string): Segment[] {
        return this.sessions.get(sessionId) ?? [];
    }

    /* Whether `text` is on the screen this client shows now or in the stream after it. */
    shows(sessionId: string, text: string): boolean {
        const segment = this.segments(sessionId).at(-1);
        return segment !== undefined && segmentShows(segment, text);
    }

    /* Resolves once `check` holds, looked at again on every frame this client reads. */
    until(check: () => boolean): Promise<void> {
        return check() ? Promise.resolve() : new Promise((resolve) => this.waiters.push({ check, resolve }));
    }

    close(): Promise<void> {
        if (this.closed) {
            return Promise.resolve();
        }
        const closed = new Promise<void>((resolve) => this.closeWaiters.push(resolve));
        this.link?.close();
        return closed;
    }

    private startSegment(sessionId: string, screen: string): void {
        const segments = this.sessions.get(sessionId) ?? [];
        segments.push({ screen, output: [], searched: new Map() });
        this.sessions.set(sessionId, segments);
    }

    private receive(text: string): void {
        const parsed = parseServerFrame(JSON.parse(text));
        if (!parsed.ok) {
            throw new Error(`The daemon sent a frame outside the protocol: ${parsed.message}`);
        }
        const frame = parsed.value;
        if ('id' in frame) {
            const waiter = frame.id === null ? undefined : this.pending.get(frame.id);
            if (waiter && frame.id !== null) {
                this.pending.delete(frame.id);
                if (frame.ok) {
                    waiter.onReply?.(frame.result);
                    waiter.resolve(frame.result);
                } else {
                    waiter.reject(new Error(`${frame.error.code}: ${frame.error.message}`));
                }
            }
        } else if (frame.event === 'session.resync') {
            const resync = EVENT_SCHEMAS['session.resync'].parse(frame.payload);
            this.startSegment(resync.sessionId, resync.screen);
        } else if (frame.event === 'session.output') {
            const output = EVENT_SCHEMAS['session.output'].parse(frame.payload);
            const segment = this.segments(output.sessionId).at(-1);
            if (!segment) {
                throw new Error(`Output for ${output.sessionId} before any screen of it`);
            }
            segment.output.push(output.data);
        }
        this.recheck();
    }

    private recheck(): void {
        const waiting = this.waiters;
        this.waiters = [];
        for (const waiter of waiting) {
            if (waiter.check()) {
                waiter.resolve();
            } else {
                this.waiters.push(waiter);
            }
        }
    }

    private handleClosed(): void {
        this.closed = true;
        for (const waiter of this.pending.values()) {
            waiter.reject(new Error('The socket closed'));
        }
        this.pending.clear();
        for (const resolve of this.closeWaiters.splice(0)) {
            resolve();
        }
        this.recheck();
    }
}

/* The WebSocket a page has. */
const openSocket = (url: string, events: LinkEvents): Promise<Link> =>
    new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        socket.onmessage = (message) => events.receive(String(message.data));
        socket.onclose = () => events.closed();
        socket.onerror = () => reject(new Error(`Could not connect to ${url}`));
        socket.onopen = () => resolve({ send: (text) => socket.send(text), close: () => socket.close() });
    });

const maskedFrame = (opcode: number, body: Buffer): Buffer => {
    if (body.length >= 65_536) {
        throw new Error('A client frame this large is not needed here');
    }
    const header =
        body.length < 126 ? Buffer.from([0x80 | opcode, 0x80 | body.length]) : Buffer.from([0x80 | opcode, 0x80 | 126, body.length >> 8, body.length & 0xff]);
    const mask = randomBytes(4);
    const masked = Buffer.alloc(body.length);
    for (let i = 0; i < body.length; i++) {
        masked[i] = body[i]! ^ mask[i % 4]!;
    }
    return Buffer.concat([header, mask, masked]);
};

/*
 * A WebSocket client that can stop reading, which the WebSocket API cannot: once the kernel's
 * buffers are full, what the daemon sends piles up in its own socket, as it does for a phone on a
 * bad line. No extensions are offered, so every frame is plain.
 */
const openPausableSocket = (url: string, events: LinkEvents): Promise<PausableLink> =>
    new Promise((resolve, reject) => {
        const target = new URL(url);
        const socket = connect({ host: target.hostname, port: Number(target.port) });
        let buffer = Buffer.alloc(0);
        let upgraded = false;
        let fragments: Buffer[] = [];
        const link: PausableLink = {
            send: (text) => {
                socket.write(maskedFrame(0x1, Buffer.from(text)));
            },
            close: () => {
                socket.destroy();
            },
            pause: () => {
                socket.pause();
            },
            resume: () => {
                socket.resume();
            }
        };
        const readFrames = (): void => {
            while (buffer.length >= 2) {
                const fin = (buffer[0]! & 0x80) !== 0;
                const opcode = buffer[0]! & 0x0f;
                let length = buffer[1]! & 0x7f;
                let offset = 2;
                if (length === 126) {
                    if (buffer.length < 4) {
                        return;
                    }
                    length = buffer.readUInt16BE(2);
                    offset = 4;
                } else if (length === 127) {
                    if (buffer.length < 10) {
                        return;
                    }
                    length = Number(buffer.readBigUInt64BE(2));
                    offset = 10;
                }
                if (buffer.length < offset + length) {
                    return;
                }
                const body = buffer.subarray(offset, offset + length);
                buffer = buffer.subarray(offset + length);
                if (opcode === 0x8) {
                    socket.destroy();
                    return;
                }
                if (opcode === 0x9) {
                    socket.write(maskedFrame(0xa, Buffer.from(body)));
                    continue;
                }
                if (opcode === 0x1 || opcode === 0x0) {
                    fragments.push(Buffer.from(body));
                    if (fin) {
                        const text = Buffer.concat(fragments).toString('utf8');
                        fragments = [];
                        events.receive(text);
                    }
                }
            }
        };
        socket.on('connect', () => {
            socket.write(
                [
                    `GET ${target.pathname}${target.search} HTTP/1.1`,
                    `Host: ${target.host}`,
                    'Upgrade: websocket',
                    'Connection: Upgrade',
                    `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
                    'Sec-WebSocket-Version: 13',
                    '',
                    ''
                ].join('\r\n')
            );
        });
        socket.on('data', (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);
            if (!upgraded) {
                const end = buffer.indexOf('\r\n\r\n');
                if (end < 0) {
                    return;
                }
                const head = buffer.subarray(0, end).toString('latin1');
                if (!head.startsWith('HTTP/1.1 101')) {
                    socket.destroy();
                    reject(new Error(`The daemon refused the upgrade: ${head.split('\r\n')[0]}`));
                    return;
                }
                upgraded = true;
                buffer = buffer.subarray(end + 4);
                resolve(link);
            }
            readFrames();
        });
        socket.on('error', (e) => reject(e));
        socket.on('close', () => events.closed());
    });

/*
 * The numbers a segment ends up showing, top to bottom. Lines are read off above the cursor after
 * each chunk and cleared, which keeps the cursor line: the only one later output can still change.
 */
const replay = async (segment: Pick<Segment, 'screen' | 'output'>): Promise<number[]> => {
    const terminal = new Terminal({ cols: COLS, rows: ROWS, scrollback: REPLAY_SCROLLBACK, allowProposedApi: true });
    const lines: string[] = [];
    const write = (data: string): Promise<void> => new Promise((resolve) => terminal.write(data, resolve));
    const readOff = (): void => {
        const buffer = terminal.buffer.active;
        if (buffer.length >= REPLAY_SCROLLBACK + ROWS) {
            throw new Error('The replay lost lines to its own scrollback');
        }
        const cursorRow = buffer.baseY + buffer.cursorY;
        for (let i = 0; i < cursorRow; i++) {
            const line = buffer.getLine(i);
            const text = line?.translateToString(true) ?? '';
            if (line?.isWrapped && lines.length > 0) {
                lines[lines.length - 1] += text;
            } else {
                lines.push(text);
            }
        }
        terminal.clear();
    };
    await write(segment.screen);
    readOff();
    const output = segment.output.join('');
    for (let offset = 0; offset < output.length; offset += REPLAY_CHUNK) {
        await write(output.slice(offset, offset + REPLAY_CHUNK));
        readOff();
    }
    terminal.dispose();
    return lines.filter((line) => /^\d+$/.test(line)).map(Number);
};

/* Every place a run of numbers skips or repeats one. */
const breaksIn = (numbers: number[]): string[] => {
    const found: string[] = [];
    for (let i = 1; i < numbers.length; i++) {
        if (numbers[i] !== numbers[i - 1]! + 1) {
            found.push(`${numbers[i - 1]} then ${numbers[i]}`);
        }
    }
    return found;
};

/* Each screen and the stream after it is one unbroken run, and the last one reaches the end of the burst. */
const expectContiguous = async (segments: Segment[], last: number): Promise<number[][]> => {
    expect(segments.length).toBeGreaterThan(0);
    const replayed: number[][] = [];
    for (const segment of segments) {
        const numbers = await replay(segment);
        expect(breaksIn(numbers)).toEqual([]);
        replayed.push(numbers);
    }
    expect(replayed.at(-1)!.at(-1)).toBe(last);
    return replayed;
};

/* The screen itself shows part of the burst and the stream after it the rest, so the seam between them was crossed. */
const expectMidBurst = async (segment: Segment, last: number): Promise<void> => {
    const screen = await replay({ screen: segment.screen, output: [] });
    expect(screen.length).toBeGreaterThan(0);
    expect(screen.at(-1)!).toBeLessThan(last);
};

let home: string;
let manager: SessionManager;
let server: Server<ClientAccess & { name: string }>;
const clients: WireClient[] = [];
// Output frames handed to each client's socket, and those counts at the moment a socket first
// answered with backpressure (-1) or a drop (0), which is where the gate stops streaming to it.
const outputFrames = new Map<string, number>();
const pushedBackAt = new Map<string, Map<string, number>>();

const noSource = { subscribe: () => () => undefined, detachAll: () => undefined };

beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-stream-'));
    manager = new SessionManager({ adapter: new BunPtyAdapter(), env: { PATH: '/usr/bin:/bin', HOME: home } });
    const dispatcher = new Dispatcher();
    registerSessionHandlers(dispatcher, manager);
    const services: ConnectionServices = {
        dispatcher,
        sessions: manager,
        chats: noSource,
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
    const connections = new Map<ServerWebSocket<ClientAccess & { name: string }>, { channel: SocketChannel; connection: OpenConnection }>();
    const watch = (channel: SocketChannel, name: string): SocketChannel => ({
        ...channel,
        send: (data) => {
            const status = channel.send(data);
            if (status !== 0 && data.startsWith('{"type":"event","event":"session.output"')) {
                outputFrames.set(name, (outputFrames.get(name) ?? 0) + 1);
            }
            if (status <= 0 && !pushedBackAt.has(name)) {
                pushedBackAt.set(name, new Map(outputFrames));
            }
            return status;
        }
    });
    // The socket options and handlers `daemon.ts` gives its own server; access is settled before an upgrade there, so it is a given here.
    server = Bun.serve<ClientAccess & { name: string }>({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request, upgrading) {
            const name = new URL(request.url).searchParams.get('name') ?? '';
            if (upgrading.upgrade(request, { data: { reachability: 'loopback', sessionId: null, name } })) {
                return undefined;
            }
            return new Response('Expected a WebSocket upgrade', { status: 426 });
        },
        websocket: {
            backpressureLimit: SOCKET_BACKPRESSURE_LIMIT,
            closeOnBackpressureLimit: true,
            open(ws) {
                const channel = watch(socketChannel(ws), ws.data.name);
                connections.set(ws, { channel, connection: openConnection(channel, ws.data) });
            },
            drain(ws) {
                connections.get(ws)?.channel.drained();
            },
            message(ws, message) {
                connections.get(ws)?.connection.receive(message);
            },
            close(ws) {
                const state = connections.get(ws);
                connections.delete(ws);
                state?.channel.closed();
            }
        }
    });
});

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
});

afterAll(async () => {
    manager.killAll();
    await waitFor(() => manager.list().every((session) => session.exited), 'every shell to exit');
    await server.stop(true);
    await rm(home, { recursive: true, force: true });
});

const socketUrl = (name: string): string => `ws://127.0.0.1:${server.port}/ws?name=${name}`;

const connectClient = async (name = ''): Promise<WireClient> => {
    const client = new WireClient();
    client.bind(await openSocket(socketUrl(name), client.events()));
    clients.push(client);
    return client;
};

const connectPausableClient = async (name: string): Promise<{ client: WireClient; link: PausableLink }> => {
    const client = new WireClient();
    const link = await openPausableSocket(socketUrl(name), client.events());
    client.bind(link);
    clients.push(client);
    return { client, link };
};

/* The client that makes the session and types the burst into it, attached from before its first line. */
const openSession = async (sessionId: string, name = ''): Promise<WireClient> => {
    const writer = await connectClient(name);
    await writer.request('session.create', { sessionId, cols: COLS, rows: ROWS, shell: '/bin/sh', cwd: home });
    await writer.attach(sessionId);
    return writer;
};

const startBurst = async (writer: WireClient, sessionId: string, last = LAST): Promise<void> => {
    await writer.request('session.write', { sessionId, data: burst(last) });
};

const untilEnd = (client: WireClient, sessionId: string): Promise<void> => client.until(() => client.shows(sessionId, END) || client.closed);

describe('terminal output over a real socket', () => {
    test(
        'a client attaching during a burst gets a screen the stream continues without a gap or a repeat',
        async () => {
            const sessionId = 'burst-attach';
            const writer = await openSession(sessionId);
            await startBurst(writer, sessionId);
            await writer.until(() => writer.shows(sessionId, MID_BURST));

            const reader = await connectClient();
            await reader.attach(sessionId);
            await Promise.all([untilEnd(writer, sessionId), untilEnd(reader, sessionId)]);

            // The client that watched from the start saw everything the shell printed.
            const [whole] = await expectContiguous(writer.segments(sessionId), LAST);
            expect(whole![0]).toBe(1);
            await expectMidBurst(reader.segments(sessionId)[0]!, LAST);
            await expectContiguous(reader.segments(sessionId), LAST);
        },
        SHELL_RUN_MS
    );

    test(
        'a reload mid-burst attaches again on a new socket without a gap or a repeat',
        async () => {
            const sessionId = 'burst-reload';
            const writer = await openSession(sessionId);
            await startBurst(writer, sessionId);
            await writer.until(() => writer.shows(sessionId, MID_BURST));

            const before = await connectClient();
            await before.attach(sessionId);
            await before.close();
            for (const segment of before.segments(sessionId)) {
                expect(breaksIn(await replay(segment))).toEqual([]);
            }

            const after = await connectClient();
            await after.attach(sessionId);
            await Promise.all([untilEnd(writer, sessionId), untilEnd(after, sessionId)]);

            await expectMidBurst(after.segments(sessionId)[0]!, LAST);
            await expectContiguous(after.segments(sessionId), LAST);
        },
        SHELL_RUN_MS
    );

    test(
        'a clear mid-burst leaves a screen the stream continues from where the clear left off',
        async () => {
            const sessionId = 'burst-clear';
            const writer = await openSession(sessionId);
            await startBurst(writer, sessionId);
            await writer.until(() => writer.shows(sessionId, MID_BURST));

            let cleared = -1;
            // The screen of the clear is the resync that came before its reply.
            await writer.request('session.clear', { sessionId }, () => {
                cleared = writer.segments(sessionId).length - 1;
            });
            await untilEnd(writer, sessionId);

            const segments = await expectContiguous(writer.segments(sessionId), LAST);
            expect(cleared).toBeGreaterThan(0);
            const before = segments[cleared - 1]!;
            const after = segments[cleared]!;
            expect(before[0]).toBe(1);
            // The clear dropped what was on the screen, so the new one starts on the line the cursor was on.
            expect(after[0]).toBe(before.at(-1)! + 1);
            expect(after.length).toBeGreaterThan(1);
        },
        SHELL_RUN_MS
    );

    test(
        'a reader that falls behind is repaired with a screen, or closed and attached again, never left with a gap',
        async () => {
            const sessionId = 'burst-slow';
            const writer = await openSession(sessionId, 'writer');
            const { client: slow, link } = await connectPausableClient('slow');
            await slow.attach(sessionId);
            link.pause();
            await startBurst(writer, sessionId, SLOW_LAST);

            // The writer gets a frame on every flush; one the slow reader did not get is output the gate dropped for it.
            const dropped = (): boolean => {
                const mark = pushedBackAt.get('slow');
                const since = (name: string): number => (outputFrames.get(name) ?? 0) - (mark?.get(name) ?? 0);
                return mark !== undefined && since('writer') > since('slow');
            };
            await writer.until(() => dropped() || writer.shows(sessionId, END));
            expect(dropped()).toBe(true);
            link.resume();
            await Promise.all([untilEnd(writer, sessionId), untilEnd(slow, sessionId)]);

            if (slow.closed) {
                const again = await connectClient();
                await again.attach(sessionId);
                await untilEnd(again, sessionId);
                await expectContiguous(again.segments(sessionId), SLOW_LAST);
                return;
            }
            const segments = slow.segments(sessionId);
            expect(segments.length).toBeGreaterThan(1);
            await expectMidBurst(segments[1]!, SLOW_LAST);
            await expectContiguous(segments, SLOW_LAST);
        },
        SHELL_RUN_MS
    );
});
