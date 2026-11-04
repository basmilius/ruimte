/*
 * What runs inside an extension's own process, ahead of its `server/index.js`: the API of `server-api.ts` over pipes
 * and files. It is bundled into `generated/server-runtime.js`, which the daemon carries as text and writes beside the
 * extension's data, so a compiled daemon can run it. It speaks one JSON line per message over stdin and stdout, so the
 * extension's `console.log` goes to stderr.
 */
import { Console } from 'node:console';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as PublicServer from '../../../../packages/extension/server';
import { callHandler, createServerApi, MissingHandler, ownValue, parseKeyValues, type KeyValues } from './server-api.ts';

type Result<Value> = PublicServer.Result<Value>;

const PRINTING_METHODS = [
    'log',
    'info',
    'debug',
    'dir',
    'dirxml',
    'table',
    'count',
    'countReset',
    'group',
    'groupCollapsed',
    'groupEnd',
    'time',
    'timeLog',
    'timeEnd',
    'trace',
    'assert'
] as const;

const [entry, dataFolder] = process.argv.slice(2);

if (entry === undefined || dataFolder === undefined) {
    throw new Error('Expected the extension entry and its data folder');
}

const folder = dataFolder;
const protocol = process.stdout.write.bind(process.stdout);

function send(message: object): void {
    protocol(`${JSON.stringify(message)}\n`);
}

// Every way the extension's own code prints goes to stderr, so stdout carries only messages.
const toStderr = new Console({ stdout: process.stderr, stderr: process.stderr });

for (const name of PRINTING_METHODS) {
    console[name] = toStderr[name].bind(toStderr) as never;
}

process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;

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

/* Only a file that is not there is empty: a write over one that could not be read would keep the new key and lose every other. */
function jsonFile(name: string): Record<string, unknown> {
    let text: string;

    try {
        text = readFileSync(join(folder, name), 'utf8');
    } catch (e) {
        if ((e as { code?: unknown }).code === 'ENOENT') {
            return {};
        }

        throw e;
    }

    const values = parseKeyValues(text);

    if (values === null) {
        throw new Error(`${name} is damaged, so nothing is read or written until it is fixed or removed`);
    }

    return values;
}

/* Through a file of its own and a rename, so a read never meets half of it. */
function writeJsonFile(name: string, value: object): void {
    const file = join(folder, name);
    const temporary = `${file}.${process.pid}.tmp`;

    mkdirSync(folder, { recursive: true });
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    renameSync(temporary, file);
}

/* Only this process writes `secrets.json`, and each write is whole before the next begins. */
function secretValues(): KeyValues {
    const name = 'secrets.json';

    return {
        get: async (key) => ownValue(jsonFile(name), key),
        set: async (key, value) => writeJsonFile(name, { ...jsonFile(name), [key]: value }),
        async delete(key) {
            const { [key]: _gone, ...rest } = jsonFile(name);

            writeJsonFile(name, rest);
        }
    };
}

/* `storage.json` is the daemon's, which a client's `useStorage` writes too, so every change waits in its one queue there. */
function storageValues(): KeyValues {
    const asking = async (method: string, args: unknown[]): Promise<unknown> => {
        const answer = await ask(method, args);

        if (!answer.ok) {
            throw new Error(answer.error.message);
        }

        return answer.value;
    };

    return {
        // In an object, since a value that is not there crosses the pipe as nothing at all.
        get: async (key) => ((await asking('storage.get', [key])) as { value?: unknown }).value,
        set: async (key, value) => void (await asking('storage.set', [key, value])),
        delete: async (key) => void (await asking('storage.delete', [key]))
    };
}

const core = createServerApi({
    dataFolder: folder,
    platform: process.platform,
    permissions: new Set<string>(JSON.parse(process.env.RUIMTE_EXTENSION_PERMISSIONS ?? '[]') as string[]),
    ask,
    clock: { every: (ms, run) => void setInterval(run, ms) },
    send,
    storage: storageValues(),
    secrets: secretValues(),
    log: {
        info: (message) => console.error(message),
        error: (message, error) => console.error(message, error ?? '')
    }
});

(globalThis as Record<string, unknown>).__ruimteExtension = {
    for: () => ({ server: core.server })
};

const { promise: loaded, resolve: resolveLoaded } = Promise.withResolvers<Readonly<Record<string, unknown>>>();

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
        void answer(message.id, async () => callHandler(await loaded, message.method, message.args));
    } else if (message.type === 'event') {
        core.deliver(message.name, message.payload);
    } else if (message.type === 'tool') {
        void answer(message.id, async () => {
            await loaded;

            return core.runTool(message.method, message.payload, message.context);
        });
    } else if (message.type === 'nodeContext') {
        void answer(message.id, async () => {
            await loaded;

            return core.readNodeContext(message.node, message.data);
        });
    }
}

let buffered = '';

// Before the module loads, so a top-level `await` of something the daemon answers gets its answer.
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
    buffered += chunk;

    for (let end = buffered.indexOf('\n'); end >= 0; end = buffered.indexOf('\n')) {
        const line = buffered.slice(0, end);

        buffered = buffered.slice(end + 1);
        handle(JSON.parse(line) as Incoming);
    }
});

const module = (await import(entry)) as { default?: Record<string, unknown> };

resolveLoaded(module.default ?? {});
send({ type: 'ready' });
