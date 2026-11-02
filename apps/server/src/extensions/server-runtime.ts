/*
 * What runs inside an extension's own process, ahead of its `server/index.js`: the API of `server-api.ts` over pipes
 * and files. It is bundled into `generated/server-runtime.js`, which the daemon carries as text and writes beside the
 * extension's data, so a compiled daemon can run it. It speaks one JSON line per message over stdin and stdout, so the
 * extension's `console.log` goes to stderr.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as PublicServer from '../../../../packages/extension/server';
import { callHandler, createServerApi, MissingHandler, type KeyValues } from './server-api.ts';

type Result<Value> = PublicServer.Result<Value>;

const [entry, dataFolder] = process.argv.slice(2);

if (entry === undefined || dataFolder === undefined) {
    throw new Error('Expected the extension entry and its data folder');
}

const folder = dataFolder;
const protocol = process.stdout;

function send(message: object): void {
    protocol.write(`${JSON.stringify(message)}\n`);
}

console.log = (...args: unknown[]) => console.error(...args);
console.info = console.log;

function jsonFile(name: string): Record<string, unknown> {
    try {
        return JSON.parse(readFileSync(join(folder, name), 'utf8')) as Record<string, unknown>;
    } catch {
        return {};
    }
}

/* Through a file of its own and a rename, so the daemon, which writes the same `storage.json`, never reads half of it. */
function writeJsonFile(name: string, value: object): void {
    const file = join(folder, name);
    const temporary = `${file}.${process.pid}.tmp`;

    mkdirSync(folder, { recursive: true });
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    renameSync(temporary, file);
}

function keyValues(name: string): KeyValues {
    return {
        get: async (key) => jsonFile(name)[key],
        set: async (key, value) => writeJsonFile(name, { ...jsonFile(name), [key]: value }),
        async delete(key) {
            const { [key]: _gone, ...rest } = jsonFile(name);

            writeJsonFile(name, rest);
        }
    };
}

const asked = new Map<number, { resolve(value: Result<unknown>): void; reject(error: Error): void }>();
let nextAsk = 1;

function ask(method: string, args: unknown[]): Promise<Result<unknown>> {
    const id = nextAsk;

    nextAsk += 1;

    return new Promise((resolve, reject) => {
        asked.set(id, { resolve, reject });
        send({ type: 'ask', id, method, args });
    });
}

const core = createServerApi({
    dataFolder: folder,
    platform: process.platform,
    permissions: new Set<string>(JSON.parse(process.env.RUIMTE_EXTENSION_PERMISSIONS ?? '[]') as string[]),
    ask,
    clock: { every: (ms, run) => void setInterval(run, ms) },
    send,
    storage: keyValues('storage.json'),
    secrets: keyValues('secrets.json'),
    log: {
        info: (message) => console.error(message),
        error: (message, error) => console.error(message, error ?? '')
    }
});

(globalThis as Record<string, unknown>).__ruimteExtension = {
    for: () => ({ server: core.server })
};

const module = (await import(entry)) as { default?: Record<string, unknown> };
const handlers = module.default ?? {};

async function answer(id: number, run: () => unknown): Promise<void> {
    try {
        send({ type: 'result', id, result: (await run()) ?? null });
    } catch (e) {
        send({ type: 'result', id, error: e instanceof Error ? e.message : String(e), ...(e instanceof MissingHandler ? { code: 'not-found' } : {}) });
    }
}

interface Incoming {
    type: string;
    id: number;
    method: string;
    args: unknown[];
    name: string;
    payload: unknown;
    node: string;
    data: unknown;
    context: { caller: string };
    // The daemon answers under a code of `ExtensionErrorCode`, or `invalid-input` for an argument of the wrong shape.
    result?: unknown;
    error?: string;
    code?: PublicServer.ExtensionErrorCode | 'invalid-input';
}

function handle(message: Incoming): void {
    if (message.type === 'answer') {
        const waiting = asked.get(message.id);
        const { result, error, code = 'failed' } = message;

        asked.delete(message.id);

        if (error === undefined) {
            waiting?.resolve({ ok: true, value: result });
        } else if (code === 'invalid-input') {
            waiting?.reject(new TypeError(error));
        } else {
            waiting?.resolve({ ok: false, error: { code, message: error } });
        }
    } else if (message.type === 'call') {
        void answer(message.id, () => callHandler(handlers, message.method, message.args));
    } else if (message.type === 'event') {
        core.deliver(message.name, message.payload);
    } else if (message.type === 'tool') {
        void answer(message.id, () => core.runTool(message.method, message.payload, message.context));
    } else if (message.type === 'nodeContext') {
        void answer(message.id, () => core.readNodeContext(message.node, message.data));
    }
}

let buffered = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
    buffered += chunk;

    for (let end = buffered.indexOf('\n'); end >= 0; end = buffered.indexOf('\n')) {
        const line = buffered.slice(0, end);

        buffered = buffered.slice(end + 1);
        handle(JSON.parse(line) as Incoming);
    }
});

send({ type: 'ready' });
