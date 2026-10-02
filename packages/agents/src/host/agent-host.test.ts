import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_EVENT_SCHEMAS, parseServerFrame, type ChatInfo, type ChatItem, type FramePort, type ReplyError, type ReplyOk } from '@ruimte/agent-contracts';
import { ChatCore } from '../chat/chat-core.ts';
import { fakeClaude } from '../chat/fake-claude.ts';
import { inProcess, type InProcessCli } from '../chat/fake-cli.ts';
import { AgentHost } from './agent-host.ts';
import { memoryPortPair } from './memory-port.ts';

/* The renderer's end of the port: a request answered by its reply, and every event as it came, checked against its schema. */
class Client {
    readonly events: { event: string; payload: unknown }[] = [];
    readonly items = new Map<string, ChatItem>();
    info: ChatInfo | null = null;
    private readonly port: FramePort;
    private readonly waiting = new Map<string, (reply: ReplyOk | ReplyError) => void>();
    private readonly watchers: Array<{ check(): boolean; resolve(): void }> = [];
    private nextId = 1;

    constructor(port: FramePort) {
        this.port = port;
        port.onFrame((raw) => this.receive(raw));
    }

    request(type: string, payload: unknown): Promise<ReplyOk | ReplyError> {
        const id = `r${this.nextId++}`;
        const reply = new Promise<ReplyOk | ReplyError>((resolve) => {
            this.waiting.set(id, resolve);
        });
        this.port.send({ id, type, payload });
        return reply;
    }

    /* Settles once `check` holds, looked at after every frame; no clock is involved. */
    until(check: () => boolean): Promise<void> {
        if (check()) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.watchers.push({ check, resolve });
        });
    }

    private receive(raw: unknown): void {
        const parsed = parseServerFrame(raw);
        if (!parsed.ok) {
            throw new Error(`The host sent a frame off the wire: ${parsed.message}`);
        }
        const frame = parsed.value;
        if ('ok' in frame) {
            this.waiting.get(frame.id ?? '')?.(frame);
        } else {
            const schema = AGENT_EVENT_SCHEMAS[frame.event as keyof typeof AGENT_EVENT_SCHEMAS];
            expect(schema?.safeParse(frame.payload).success).toBe(true);
            this.events.push({ event: frame.event, payload: frame.payload });
            this.apply(frame.event, frame.payload);
        }
        for (const watcher of [...this.watchers]) {
            if (watcher.check()) {
                this.watchers.splice(this.watchers.indexOf(watcher), 1);
                watcher.resolve();
            }
        }
    }

    private apply(event: string, payload: unknown): void {
        if (event !== 'chat.event') {
            return;
        }
        const { event: chatEvent } = AGENT_EVENT_SCHEMAS['chat.event'].parse(payload);
        if (chatEvent.type === 'item') {
            this.items.set(chatEvent.item.id, chatEvent.item);
        } else if (chatEvent.type === 'delta') {
            const item = this.items.get(chatEvent.itemId);
            if (item?.kind === 'assistant') {
                this.items.set(item.id, { ...item, text: item.text + chatEvent.text });
            }
        } else {
            this.info = chatEvent.info;
        }
    }
}

let dataDir: string;
let claude: InProcessCli;
let host: AgentHost;
let client: Client;

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'agents-host-'));
    claude = inProcess(fakeClaude);
    host = await AgentHost.open({
        dataDir,
        env: { HOME: dataDir, PATH: process.env.PATH },
        systemNote: 'You work in the motion editor.',
        background: false,
        command: ['claude'],
        spawn: claude.spawn
    });
    const [renderer, utility] = memoryPortPair();
    host.connect(utility);
    client = new Client(renderer);
});

afterEach(async () => {
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
});

const ok = (reply: ReplyOk | ReplyError): unknown => {
    if (!reply.ok) {
        throw new Error(`${reply.error.code}: ${reply.error.message}`);
    }
    return reply.result;
};

describe('AgentHost over a port', () => {
    test('runs a whole turn of a chat and says what it does to the client', async () => {
        const created = ok(await client.request('chat.create', { chatId: 'chat-1', provider: 'claude', cwd: dataDir })) as ChatInfo;
        expect(created).toMatchObject({ chatId: 'chat-1', provider: 'claude', status: 'idle' });
        ok(await client.request('chat.attach', { chatId: 'chat-1' }));

        expect(ok(await client.request('chat.send', { chatId: 'chat-1', text: 'hello there' }))).toMatchObject({ queued: false });
        await client.until(
            () => client.info?.activeTurnId === null && [...client.items.values()].some((item) => item.kind === 'turn' && item.state === 'done')
        );

        const assistant = [...client.items.values()].filter((item) => item.kind === 'assistant');
        expect(assistant.map((item) => item.kind === 'assistant' && item.text)).toEqual(['echo: hello there']);
        expect(client.events.some((event) => event.event === 'chat.status')).toBe(true);
        // What the app tells every agent reaches the CLI as its system prompt.
        const argv = claude.started[0]!.argv;
        expect(argv[argv.indexOf('--append-system-prompt') + 1]).toBe('You work in the motion editor.');
        expect(ok(await client.request('chat.list', {}))).toMatchObject({ chats: [{ chatId: 'chat-1', status: 'idle' }] });
    });

    test('refuses what it cannot serve with a code, and a frame off the wire as a bad request', async () => {
        ok(await client.request('chat.create', { chatId: 'chat-2', provider: 'claude', cwd: dataDir }));
        expect(await client.request('chat.fork', { chatId: 'chat-2', turnId: 'turn-1' })).toMatchObject({ ok: false, error: { code: 'chat-unsupported' } });
        expect(await client.request('session.create', {})).toMatchObject({ ok: false, error: { code: 'unknown-request' } });
        expect(await client.request('chat.send', { chatId: 'chat-2' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
        expect(await client.request('chat.send', { chatId: 'nobody', text: 'hi' })).toMatchObject({ ok: false, error: { code: 'chat-not-found' } });
    });

    test('closing ends every CLI, and the chat goes on in the next host through the CLI session', async () => {
        ok(await client.request('chat.create', { chatId: 'chat-3', provider: 'claude', cwd: dataDir }));
        ok(await client.request('chat.attach', { chatId: 'chat-3' }));
        ok(await client.request('chat.send', { chatId: 'chat-3', text: 'hello there' }));
        await client.until(() => client.info?.activeTurnId === null && client.info.agentSessionId !== null);
        const session = client.info!.agentSessionId;

        await host.close();
        await claude.started[0]!.exited;

        host = await AgentHost.open({ dataDir, env: { HOME: dataDir, PATH: process.env.PATH }, background: false, command: ['claude'], spawn: claude.spawn });
        const [renderer, utility] = memoryPortPair();
        host.connect(utility);
        client = new Client(renderer);
        expect(ok(await client.request('chat.create', { chatId: 'chat-3' }))).toMatchObject({ agentSessionId: session });
        ok(await client.request('chat.attach', { chatId: 'chat-3' }));
        ok(await client.request('chat.send', { chatId: 'chat-3', text: 'again' }));
        await client.until(() => [...client.items.values()].some((item) => item.kind === 'assistant' && item.text === 'echo: again'));
        const argv = claude.started.at(-1)!.argv;
        expect(argv[argv.indexOf('--resume') + 1]).toBe(session!);
    });

    test('runs on a core of the app, whose overrides reach the CLI', async () => {
        class BriefedCore extends ChatCore {
            protected override instructionsFor(chatId: string): string | null {
                return `You are the agent of ${chatId}.`;
            }
        }
        await host.close();
        const briefed = await AgentHost.open({
            dataDir,
            env: { HOME: dataDir, PATH: process.env.PATH },
            systemNote: 'You work in the motion editor.',
            background: false,
            command: ['claude'],
            spawn: claude.spawn,
            core: (options) => new BriefedCore(options)
        });
        host = briefed;
        expect(briefed.chats).toBeInstanceOf(BriefedCore);
        const [renderer, utility] = memoryPortPair();
        host.connect(utility);
        client = new Client(renderer);

        ok(await client.request('chat.create', { chatId: 'chat-4', provider: 'claude', cwd: dataDir }));
        ok(await client.request('chat.attach', { chatId: 'chat-4' }));
        ok(await client.request('chat.send', { chatId: 'chat-4', text: 'hello there' }));
        await client.until(() => [...client.items.values()].some((item) => item.kind === 'assistant' && item.text === 'echo: hello there'));
        const argv = claude.started.at(-1)!.argv;
        expect(argv[argv.indexOf('--append-system-prompt') + 1]).toBe('You are the agent of chat-4.');
    });

    test('hands a chat the folders of its core, and a change starts the next turn in a new process', async () => {
        const reading: string[] = ['/brand/kit'];
        class ReadingCore extends ChatCore {
            protected override foldersFor(_chatId: string): readonly string[] {
                return [...reading];
            }
        }
        await host.close();
        host = await AgentHost.open({
            dataDir,
            env: { HOME: dataDir, PATH: process.env.PATH },
            background: false,
            command: ['claude'],
            spawn: claude.spawn,
            core: (options) => new ReadingCore(options)
        });
        const [renderer, utility] = memoryPortPair();
        host.connect(utility);
        client = new Client(renderer);
        const answered = (text: string): boolean => [...client.items.values()].some((item) => item.kind === 'assistant' && item.text === `echo: ${text}`);

        ok(await client.request('chat.create', { chatId: 'chat-5', provider: 'claude', cwd: dataDir }));
        ok(await client.request('chat.attach', { chatId: 'chat-5' }));
        ok(await client.request('chat.send', { chatId: 'chat-5', text: 'read the kit' }));
        await client.until(() => answered('read the kit'));
        const launches = claude.started.length;
        expect(claude.started.at(-1)!.argv).toContain('--add-dir=/brand/kit');

        ok(await client.request('chat.send', { chatId: 'chat-5', text: 'same folders' }));
        await client.until(() => answered('same folders'));
        expect(claude.started.length).toBe(launches);

        reading.length = 0;
        ok(await client.request('chat.send', { chatId: 'chat-5', text: 'done reading' }));
        await client.until(() => answered('done reading'));
        expect(claude.started.length).toBe(launches + 1);
        const argv = claude.started.at(-1)!.argv;
        expect(argv.some((arg) => arg.startsWith('--add-dir'))).toBe(false);
        expect(argv).toContain('--resume');
    });

    test('refuses a chat whose record it cannot read, and leaves the record and its log as they are', async () => {
        ok(await client.request('chat.create', { chatId: 'chat-6', provider: 'claude', cwd: dataDir }));
        ok(await client.request('chat.attach', { chatId: 'chat-6' }));
        ok(await client.request('chat.send', { chatId: 'chat-6', text: 'hello there' }));
        await client.until(() => client.info?.activeTurnId === null && [...client.items.values()].some((item) => item.kind === 'assistant'));
        await host.close();

        const recordPath = join(dataDir, 'chats', 'chat-6.json');
        const record = JSON.parse(await readFile(recordPath, 'utf8')) as { items: unknown[] };
        // An item of a kind a newer version writes.
        record.items.push({ id: 'future-1', kind: 'future-kind', createdAt: 2, turnId: null, text: 'from a newer build' });
        const bytes = JSON.stringify(record);
        await writeFile(recordPath, bytes);
        const logPath = join(dataDir, 'chats', 'chat-6.log');
        const log = await readFile(logPath, 'utf8').catch(() => null);

        host = await AgentHost.open({ dataDir, env: { HOME: dataDir, PATH: process.env.PATH }, background: false, command: ['claude'], spawn: claude.spawn });
        const [renderer, utility] = memoryPortPair();
        host.connect(utility);
        client = new Client(renderer);
        expect(await client.request('chat.create', { chatId: 'chat-6' })).toMatchObject({ ok: false, error: { code: 'chat-unreadable' } });
        await host.chats.persisted('chat-6');
        expect(await readFile(recordPath, 'utf8')).toBe(bytes);
        expect(await readFile(logPath, 'utf8').catch(() => null)).toBe(log);
    });
});
