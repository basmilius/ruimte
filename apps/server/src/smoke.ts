import { parseServerFrame, type RequestMap, type RequestType } from '@ruimte/contracts';
import { DEFAULT_HOST, DEFAULT_PORT } from './config.ts';

// Manual check against a running daemon: create a session, run uname, print the screen, kill it.
// Usage: bun run --cwd apps/server smoke [ws://host:port/ws]

const url = process.argv[2] ?? `ws://${DEFAULT_HOST}:${DEFAULT_PORT}/ws`;
const sessionId = `smoke-${Date.now()}`;
const SCREEN_DELAY_MS = 500;

const socket = new WebSocket(url);
const pending = new Map<string, { resolve(result: unknown): void; reject(error: Error): void }>();
let nextId = 1;
let output = '';

const request = <T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> =>
    new Promise((resolve, reject) => {
        const id = String(nextId++);
        pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
        socket.send(JSON.stringify({ id, type, payload }));
    });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

socket.onmessage = (message) => {
    const parsed = parseServerFrame(JSON.parse(String(message.data)));
    if (!parsed.ok) {
        console.error('Unreadable frame:', parsed.message);
        return;
    }
    const frame = parsed.value;
    if ('id' in frame) {
        const waiter = frame.id === null ? undefined : pending.get(frame.id);
        if (!waiter || frame.id === null) {
            return;
        }
        pending.delete(frame.id);
        if (frame.ok) {
            waiter.resolve(frame.result);
        } else {
            waiter.reject(new Error(`${frame.error.code}: ${frame.error.message}`));
        }
        return;
    }
    if (frame.event === 'session.output') {
        output += (frame.payload as { data: string }).data;
    } else if (frame.event === 'session.exit') {
        console.log(`event session.exit ${JSON.stringify(frame.payload)}`);
    }
};

socket.onerror = () => {
    console.error(`Could not connect to ${url}. Is the daemon running?`);
    process.exit(1);
};

socket.onopen = async () => {
    try {
        const hello = await request('server.hello', {});
        console.log(`connected to ruimte server ${hello.version} on ${hello.platform} (home: ${hello.home})`);

        const info = await request('session.create', { sessionId, cols: 80, rows: 24 });
        console.log(`created session ${info.sessionId} (pid ${info.pid})`);

        const attached = await request('session.attach', { sessionId, cols: 80, rows: 24 });
        console.log(`attached, screen was ${attached.screen.length} chars`);

        await request('session.write', { sessionId, data: 'uname\n' });
        await sleep(SCREEN_DELAY_MS);

        console.log('--- streamed output ---');
        console.log(output);
        console.log('--- serialized screen on reattach ---');
        await request('session.detach', { sessionId });
        const again = await request('session.attach', { sessionId, cols: 80, rows: 24 });
        console.log(again.screen);
        console.log('---');

        await request('session.kill', { sessionId });
        await sleep(200);
        const list = await request('session.list', {});
        console.log(`sessions left: ${list.sessions.map((session) => session.sessionId).join(', ') || '(none)'}`);
        socket.close();
        process.exit(0);
    } catch (e) {
        console.error('smoke failed:', e instanceof Error ? e.message : e);
        process.exit(1);
    }
};
