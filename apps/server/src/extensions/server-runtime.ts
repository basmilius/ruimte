/*
 * What runs inside an extension's own process, ahead of its `server/index.js`. The daemon carries this
 * file as text and writes it beside the extension's data, so a compiled daemon can run it. It speaks
 * one JSON line per message over stdin and stdout, so the extension's `console.log` goes to stderr.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Listener = (payload: unknown) => void;
type Handlers = Record<string, (...args: unknown[]) => unknown>;

const [entry, dataFolder] = process.argv.slice(2);

if (entry === undefined || dataFolder === undefined) {
    throw new Error('Expected the extension entry and its data folder');
}

const protocol = process.stdout;
const listeners = new Map<string, Set<Listener>>();
const tools = new Map<string, { run(input: unknown, context: { caller: string }): unknown }>();
const nodeContexts = new Map<string, (node: { data: unknown }) => unknown>();

function send(message: object): void {
    protocol.write(`${JSON.stringify(message)}\n`);
}

console.log = (...args: unknown[]) => console.error(...args);
console.info = console.log;

function jsonFile(name: string): Record<string, unknown> {
    try {
        return JSON.parse(readFileSync(join(dataFolder as string, name), 'utf8')) as Record<string, unknown>;
    } catch {
        return {};
    }
}

function writeJsonFile(name: string, value: object): void {
    mkdirSync(dataFolder as string, { recursive: true });
    writeFileSync(join(dataFolder as string, name), JSON.stringify(value), { mode: 0o600 });
}

function keyValues(name: string) {
    return {
        async get(key: string): Promise<unknown> {
            return jsonFile(name)[key];
        },
        async set(key: string, value: unknown): Promise<void> {
            writeJsonFile(name, { ...jsonFile(name), [key]: value });
        },
        async delete(key: string): Promise<void> {
            const { [key]: _gone, ...rest } = jsonFile(name);

            writeJsonFile(name, rest);
        }
    };
}

const permissions = new Set<string>(JSON.parse(process.env.RUIMTE_EXTENSION_PERMISSIONS ?? '[]') as string[]);
const asked = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
let nextAsk = 1;

/* The daemon holds what this process does not: the person's agents and chats. It checks the permission too. */
function ask(method: string, args: unknown[]): Promise<unknown> {
    const id = nextAsk;

    nextAsk += 1;

    return new Promise((resolve, reject) => {
        asked.set(id, { resolve, reject });
        send({ type: 'ask', id, method, args });
    });
}

const UNITS: Readonly<Record<string, number>> = { s: 1000, m: 60_000, h: 3_600_000 };
const MIN_EVERY_MS = 10_000;

function everyMs(every: string): number {
    const match = /^(\d+)([smh])$/.exec(every);
    const ms = match === null ? 0 : Number(match[1]) * (UNITS[match[2] as string] as number);

    if (ms < MIN_EVERY_MS) {
        throw new Error(`schedule takes something like 30s, 5m or 1h, of at least 10 seconds, not ${every}`);
    }

    return ms;
}

const server = {
    machine: { platform: process.platform, dataFolder },
    agents: {
        run: (options: { prompt: string; context?: string[]; provider?: string }) => ask('agents.run', [options]),
        start: (options: { projectId: string; prompt?: string; provider?: string; title?: string; viewId?: string; beside?: string }) =>
            ask('agents.start', [options])
    },
    chats: {
        send: (chatId: string, text: string) => ask('chats.send', [chatId, text]),
        list: () => ask('chats.list', [])
    },
    defineAgentTool(tool: { id: string; description: string; parameters?: unknown; run(input: unknown, context: { caller: string }): unknown }): void {
        tools.set(tool.id, tool);
        send({ type: 'tool', name: tool.id, description: tool.description, parameters: tool.parameters ?? { type: 'object', properties: {} } });
    },
    schedule(task: { id: string; every: string; run(): unknown }): void {
        if (!permissions.has('clock')) {
            throw new Error('schedule needs the permission clock in manifest.json');
        }

        setInterval(() => {
            void (async () => task.run())().catch((e: unknown) => console.error(`${task.id} failed:`, e));
        }, everyMs(task.every));
    },
    defineServer: <Api extends Handlers>(api: Api): Api => api,
    onEvent(name: string, listener: Listener): () => void {
        const group = listeners.get(name) ?? new Set();

        group.add(listener);
        listeners.set(name, group);
        send({ type: 'subscribe', name });

        return () => {
            group.delete(listener);
        };
    },
    emit(name: string, payload: unknown): void {
        send({ type: 'emit', name, payload });
    },
    defineNodeContext(nodeId: string, read: (node: { data: unknown }) => unknown): void {
        nodeContexts.set(nodeId, read);
    },
    storage: keyValues('storage.json'),
    secrets: keyValues('secrets.json'),
    log: {
        info: (message: string) => console.error(message),
        error: (message: string, error?: unknown) => console.error(message, error ?? '')
    }
};

(globalThis as Record<string, unknown>).__ruimteExtension = {
    for: () => ({ server })
};

const module = (await import(entry)) as { default?: Handlers };
const handlers = module.default ?? {};

async function answer(id: number, run: () => unknown): Promise<void> {
    try {
        send({ type: 'result', id, result: (await run()) ?? null });
    } catch (e) {
        send({ type: 'result', id, error: e instanceof Error ? e.message : String(e) });
    }
}

let buffered = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
    buffered += chunk;

    for (let end = buffered.indexOf('\n'); end >= 0; end = buffered.indexOf('\n')) {
        const line = buffered.slice(0, end);

        buffered = buffered.slice(end + 1);

        const message = JSON.parse(line) as {
            type: string;
            id: number;
            method: string;
            args: unknown[];
            name: string;
            payload: unknown;
            node: string;
            data: unknown;
        };

        if (message.type === 'answer') {
            const waiting = asked.get(message.id);
            const { result, error } = message as { result?: unknown; error?: string };

            asked.delete(message.id);

            if (error === undefined) {
                waiting?.resolve(result);
            } else {
                waiting?.reject(new Error(error));
            }
        } else if (message.type === 'call') {
            void answer(message.id, () => {
                const handler = handlers[message.method];

                if (handler === undefined) {
                    throw new Error(`No method ${message.method}`);
                }

                return handler(...message.args);
            });
        } else if (message.type === 'event') {
            for (const listener of listeners.get(message.name) ?? []) {
                listener(message.payload);
            }
        } else if (message.type === 'tool') {
            const { payload, context } = message as unknown as { payload: unknown; context: { caller: string } };

            void answer(message.id, () => {
                const tool = tools.get(message.method);

                if (tool === undefined) {
                    throw new Error(`No tool ${message.method}`);
                }

                return tool.run(payload, context);
            });
        } else if (message.type === 'nodeContext') {
            void answer(message.id, () => nodeContexts.get(message.node)?.({ data: message.data }) ?? []);
        }
    }
});

send({ type: 'ready' });
