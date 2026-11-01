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
const nodeContexts = new Map<string, (node: { data: unknown }) => unknown>();
const tools = new Map<string, { description: string; run: (input: unknown) => unknown }>();

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
        }
    };
}

const server = {
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
    defineAgentTool(tool: { id: string; description: string; run: (input: unknown) => unknown }): void {
        tools.set(tool.id, tool);
        send({ type: 'tool', id: tool.id, description: tool.description });
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

        if (message.type === 'call') {
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
        } else if (message.type === 'nodeContext') {
            void answer(message.id, () => nodeContexts.get(message.node)?.({ data: message.data }) ?? []);
        } else if (message.type === 'tool') {
            void answer(message.id, () => tools.get(message.method)?.run(message.payload));
        }
    }
});

send({ type: 'ready' });
