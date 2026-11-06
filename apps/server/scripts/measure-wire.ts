import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { DeflatedFrameAssembler, FrameAssembler, isDeflatedPiece, splitFrame, type ProjectContent } from '@ruimte/contracts';
import { RTCPeerConnection, type RTCDataChannel } from 'werift';
import { readLocalSecret } from '../src/auth/local-secret.ts';
import { projectOverlays } from '../src/projects/overlays.ts';
import { projectLinks } from '../src/projects/project-file-test-helpers.ts';
import { ProjectStore } from '../src/projects/project-store.ts';
import { directChannel, fromWerift, type DirectChannel, type RawDataChannel } from '../src/pulsar/data-channel.ts';

/*
 * What a remote client's frames cost on a direct channel, as text and deflated. A real daemon in a
 * throwaway home opens a clone of a repository with copies of real chats, the way a client opens a
 * project; the frames it answered with are then replayed over the daemon's own `directChannel` to a
 * client in a process of its own, on werift over loopback, which measures both ends' code and not a network.
 *
 *   bun apps/server/scripts/measure-wire.ts <repository> [chats folder, default ~/.ruimte/chats] > wire.json
 *
 * The chats never leave memory and the home is removed afterwards. The daemon gets a PATH without agent
 * CLIs and a HOME of its own, so no agent starts and no setting of this machine is touched.
 */

const CHAT_COUNT = 12;
// A port of its own, away from an installed daemon (4210) and a dev daemon (4211).
const PORT = 4291;
const REPEATS = 5;
const BURSTS = [1, 2, 4, 8, 16];

type Variant = 'text' | 'deflate';

function pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function median(values: number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)]!;
}

function waitFor(check: () => boolean): Promise<void> {
    return new Promise((resolve) => {
        const poll = () => (check() ? resolve() : setTimeout(poll, 1));
        poll();
    });
}

/* Plays a client opening a project against a real daemon, and answers every frame it received. */
async function capture(repository: string, chatSource: string): Promise<string[]> {
    const root = await mkdtemp(join(tmpdir(), 'ruimte-measure-wire-'));
    const home = join(root, 'home');
    const userHome = join(root, 'user');
    const folder = join(root, 'repo');
    await mkdir(join(home, 'chats'), { recursive: true });
    await mkdir(userHome, { recursive: true });
    Bun.spawnSync(['git', 'clone', '--quiet', '--local', repository, folder]);

    // A spread over the sizes: the largest few and an even sample of the rest.
    const chatFiles = (await readdir(chatSource)).filter((name) => /^chat-[a-z0-9]+\.json$/.test(name));
    const sized = await Promise.all(chatFiles.map(async (name) => ({ name, size: (await stat(join(chatSource, name))).size })));
    sized.sort((left, right) => right.size - left.size);
    const step = Math.max(1, Math.floor(sized.length / CHAT_COUNT));
    const picked = sized.filter((_, index) => index < 3 || index % step === 0).slice(0, CHAT_COUNT);
    const chats: Array<{ chatId: string; provider: unknown }> = [];
    for (const chat of picked) {
        const stored = JSON.parse(await readFile(join(chatSource, chat.name), 'utf8')) as {
            info: { chatId: string; provider: unknown; cwd: string; running: boolean };
        };
        stored.info.cwd = folder;
        stored.info.running = false;
        await writeFile(join(home, 'chats', chat.name), JSON.stringify(stored));
        chats.push({ chatId: stored.info.chatId, provider: stored.info.provider });
    }
    console.error(`chats: ${picked.map((chat) => `${Math.round(chat.size / 1024)} KB`).join(', ')}`);

    const store = new ProjectStore(home, projectLinks(), projectOverlays(home));
    const opened = await store.openProject({ folder });
    const content: ProjectContent = {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [
                    ...chats.map(({ chatId }, index) => ({
                        id: chatId,
                        kind: 'chat' as const,
                        title: chatId,
                        x: index * 500,
                        y: 0,
                        w: 480,
                        h: 520,
                        provider: 'claude' as const
                    })),
                    { id: 'term-1', kind: 'terminal' as const, title: 'Terminal', x: 0, y: 600, w: 640, h: 400 }
                ],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    };
    await store.save(opened.summary.projectId, opened.document.rev, content);
    store.release(opened.summary.projectId);

    const daemon = Bun.spawn([process.execPath, '--conditions=source', 'src/main.ts', '--port', String(PORT), '--no-broker', '--no-lan'], {
        cwd: join(import.meta.dir, '..'),
        env: { RUIMTE_HOME: home, HOME: userHome, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` },
        stdout: 'ignore',
        stderr: 'inherit'
    });
    try {
        let secret: string | null = null;
        for (let attempt = 0; attempt < 100 && secret === null; attempt++) {
            await pause(200);
            secret = await readLocalSecret(home);
        }
        let socket: WebSocket | null = null;
        for (let attempt = 0; attempt < 50 && socket === null; attempt++) {
            socket = await new Promise<WebSocket | null>((resolve) => {
                // The local secret goes in the Authorization header, the only place the daemon takes it from.
                const options: Bun.WebSocketOptions = { headers: { authorization: `Bearer ${secret ?? ''}` } };
                const candidate = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, options as unknown as string[]);
                candidate.onopen = () => resolve(candidate);
                candidate.onerror = () => resolve(null);
            });
            if (socket === null) {
                await pause(200);
            }
        }
        if (socket === null) {
            throw new Error(`The daemon never answered on port ${PORT}`);
        }
        const ws = socket;
        const waiters = new Map<string, (frame: { ok: boolean; result?: unknown; error?: unknown }) => void>();
        let nextId = 1;
        const captured: string[] = [];
        ws.onmessage = (message) => {
            if (typeof message.data !== 'string') {
                return;
            }
            captured.push(message.data);
            const frame = JSON.parse(message.data) as { id?: string; ok?: boolean; result?: unknown; error?: unknown };
            if (typeof frame.id === 'string') {
                waiters.get(frame.id)?.({ ok: frame.ok === true, result: frame.result, error: frame.error });
                waiters.delete(frame.id);
            }
        };
        const request = (type: string, payload: unknown): Promise<unknown> => {
            const id = String(nextId++);
            return new Promise((resolve) => {
                waiters.set(id, (frame) => {
                    if (!frame.ok) {
                        console.error(`${type} failed: ${JSON.stringify(frame.error)}`);
                    }
                    resolve(frame.result);
                });
                ws.send(JSON.stringify({ id, type, payload }));
            });
        };

        await request('server.hello', {});
        await request('endpoint.info', {});
        await request('project.list', {});
        await request('project.open', { projectId: opened.summary.projectId });
        await request('chat.list', {});
        for (const { chatId, provider } of chats) {
            await request('chat.create', { chatId, provider, cwd: folder });
            // As the clients ask: the newest page, one page back for a scroll, and a reconnect from the last seq.
            const attached = (await request('chat.attach', { chatId, historyLimit: 60 })) as { history?: { cursor: string | null }; seq?: number } | undefined;
            if (typeof attached?.history?.cursor === 'string') {
                await request('chat.history', { chatId, cursor: attached.history.cursor, limit: 60 });
            }
            await request('chat.detach', { chatId });
            await request('chat.attach', { chatId, historyLimit: 60, since: attached?.seq ?? 0 });
        }
        await request('git.status', { cwd: folder });
        await request('git.log', { cwd: folder, limit: 50 });
        await request('git.diff', { cwd: folder, scope: 'commit', commit: 'HEAD' });
        await request('fs.list', { path: folder, depth: 2 });
        for (const file of ['README.md', 'CLAUDE.md', 'apps/server/README.md', 'packages/contracts/src/index.ts']) {
            await request('fs.read', { path: join(folder, file) });
        }
        await request('session.create', { sessionId: 'term-1', cwd: folder, cols: 120, rows: 40 });
        await request('session.attach', { sessionId: 'term-1', cols: 120, rows: 40 });
        for (const command of ['git log --stat -n 40 | cat', 'ls -la apps/server/src', 'cat apps/server/README.md']) {
            await request('session.write', { sessionId: 'term-1', data: `${command}\r` });
            await pause(1_500);
        }
        await request('session.detach', { sessionId: 'term-1' });
        await request('session.attach', { sessionId: 'term-1', cols: 120, rows: 40 });
        await request('session.kill', { sessionId: 'term-1' });
        ws.close();
        return captured;
    } finally {
        daemon.kill();
        await daemon.exited;
        await rm(root, { recursive: true, force: true });
    }
}

/* The client: joins text and deflated pieces, inflates, parses, and acks every frame by its index. */
async function client(): Promise<void> {
    const peer = new RTCPeerConnection({});
    const text = new FrameAssembler();
    const deflated = new DeflatedFrameAssembler();
    let inflateMs = 0;
    let parseMs = 0;
    peer.onDataChannel.subscribe((channel: RTCDataChannel) => {
        const reply = (frame: string) => {
            for (const piece of splitFrame(frame)) {
                channel.send(piece);
            }
        };
        channel.onMessage.subscribe((data: string | Buffer) => {
            let frame: string | null = null;
            if (typeof data !== 'string' && isDeflatedPiece(data)) {
                const piece = deflated.push(data, Number.MAX_SAFE_INTEGER);
                if (piece.kind === 'frame') {
                    const started = performance.now();
                    frame = inflateRawSync(piece.frame).toString();
                    inflateMs += performance.now() - started;
                }
            } else {
                const piece = text.push(String(data), Number.MAX_SAFE_INTEGER);
                frame = piece.kind === 'frame' ? piece.frame : null;
            }
            if (frame === null) {
                return;
            }
            if (frame === 'report') {
                reply(`report ${JSON.stringify({ inflateMs, parseMs })}`);
                inflateMs = 0;
                parseMs = 0;
                return;
            }
            const started = performance.now();
            const parsed = JSON.parse(frame) as { probe?: number };
            parseMs += performance.now() - started;
            reply(`ack ${parsed.probe}`);
        });
    });
    for await (const line of console) {
        const offer = JSON.parse(line) as { sdp: string };
        await peer.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
        await peer.setLocalDescription(await peer.createAnswer());
        await waitFor(() => peer.iceGatheringState === 'complete');
        process.stdout.write(`${JSON.stringify({ sdp: peer.localDescription!.sdp })}\n`);
    }
}

/* The daemon's side of a channel to a client process, with the bytes that went on the wire counted. */
async function connect(): Promise<{ channel: DirectChannel; wireBytes: () => number; stop(): Promise<void> }> {
    const child = Bun.spawn([process.execPath, '--conditions=source', import.meta.path, 'client'], { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' });
    const peer = new RTCPeerConnection({});
    const raw = peer.createDataChannel('ruimte', { ordered: true });
    let wire = 0;
    const counted = fromWerift(raw);
    const send = counted.send;
    const measured: RawDataChannel = Object.assign(counted, {
        send: (data: string | Uint8Array) => {
            wire += typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
            send(data);
        }
    });
    await peer.setLocalDescription(await peer.createOffer());
    await waitFor(() => peer.iceGatheringState === 'complete');
    child.stdin.write(`${JSON.stringify({ sdp: peer.localDescription!.sdp })}\n`);
    await child.stdin.flush();
    const reader = child.stdout.getReader();
    let buffered = '';
    while (!buffered.includes('\n')) {
        const { value } = await reader.read();
        buffered += new TextDecoder().decode(value);
    }
    await peer.setRemoteDescription({ type: 'answer', sdp: (JSON.parse(buffered.split('\n')[0]!) as { sdp: string }).sdp });
    await waitFor(() => raw.readyState === 'open');
    return {
        channel: directChannel(measured),
        wireBytes: () => wire,
        stop: async () => {
            await peer.close();
            child.kill();
            await child.exited;
        }
    };
}

/* Tags each frame with its index, so the client's ack names it. */
function tagged(frame: string, index: number): string {
    return `{"probe":${index},${frame.slice(1)}`;
}

async function replay(variant: Variant, frames: string[]): Promise<Record<string, number>> {
    const { channel, wireBytes, stop } = await connect();
    const acks = new Map<number, () => void>();
    let report: { inflateMs: number; parseMs: number } | null = null;
    channel.receiveWith((frame) => {
        if (frame.startsWith('ack ')) {
            const index = Number(frame.slice(4));
            acks.get(index)?.();
            acks.delete(index);
        } else if (frame.startsWith('report ')) {
            report = JSON.parse(frame.slice(7)) as { inflateMs: number; parseMs: number };
        }
    }, Number.MAX_SAFE_INTEGER);
    if (variant === 'deflate') {
        channel.deflate();
    }
    let sendMs = 0;
    const send = (frame: string, index: number): Promise<void> => {
        const acked = new Promise<void>((resolve) => acks.set(index, resolve));
        const started = performance.now();
        channel.send(tagged(frame, index));
        sendMs += performance.now() - started;
        return acked;
    };

    // Warms the congestion window up before anything is timed.
    await send(JSON.stringify({ warm: 'x'.repeat(1_000_000) }), -1);

    const wireBefore = wireBytes();
    sendMs = 0;
    let started = performance.now();
    await Promise.all(frames.map((frame, index) => send(frame, index)));
    const burstMs = performance.now() - started;
    const burstWire = wireBytes() - wireBefore;
    const burstSendMs = sendMs;
    channel.send('report');
    await waitFor(() => report !== null);
    const client = report as unknown as { inflateMs: number; parseMs: number };

    started = performance.now();
    for (const [index, frame] of frames.entries()) {
        await send(frame, index);
    }
    const sequentialMs = performance.now() - started;

    const largest = frames.reduce((best, frame) => (frame.length > best.length ? frame : best));
    const echo = '{"type":"event","event":"session.output","payload":{"sessionId":"term-1","data":"a"}}';
    const alone: number[] = [];
    const behind: number[] = [];
    for (let i = 0; i < REPEATS; i++) {
        const sent = performance.now();
        const done = [
            send(largest, 1_000_000).then(() => alone.push(performance.now() - sent)),
            send(echo, 1_000_001).then(() => behind.push(performance.now() - sent))
        ];
        await Promise.all(done);
    }

    const bursts: Record<string, number> = {};
    for (const copies of BURSTS) {
        started = performance.now();
        await Promise.all(Array.from({ length: copies }, (_, i) => send(largest, 2_000_000 + i)));
        bursts[`burst${copies}xMs`] = Math.round(performance.now() - started);
    }
    await stop();
    return {
        frames: frames.length,
        rawKB: Math.round(frames.reduce((total, frame) => total + Buffer.byteLength(frame), 0) / 1024),
        wireKB: Math.round(burstWire / 1024),
        burstMs: Math.round(burstMs),
        sequentialMs: Math.round(sequentialMs),
        daemonSendMs: Math.round(burstSendMs),
        clientInflateMs: Math.round(client.inflateMs),
        clientParseMs: Math.round(client.parseMs),
        largestKB: Math.round(Buffer.byteLength(largest) / 1024),
        largestMs: Math.round(median(alone)),
        echoBehindLargestMs: Math.round(median(behind)),
        ...bursts
    };
}

if (process.argv[2] === 'client') {
    await client();
} else {
    const repository = process.argv[2];
    if (repository === undefined) {
        console.error('Usage: bun apps/server/scripts/measure-wire.ts <repository> [chats folder]');
        process.exit(2);
    }
    const frames = await capture(repository, process.argv[3] ?? join(homedir(), '.ruimte', 'chats'));
    const results: Record<string, Array<Record<string, number>>> = { text: [], deflate: [] };
    for (const variant of ['text', 'deflate', 'text', 'deflate'] as Variant[]) {
        const result = await replay(variant, frames);
        console.error(variant, JSON.stringify(result));
        results[variant]!.push(result);
    }
    console.log(JSON.stringify(results, null, 2));
    process.exit(0);
}
