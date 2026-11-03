/*
 * The `@ruimte/extension/server` an extension's `server/` imports, with everything around it handed in: how it asks the
 * daemon, its clock, where it says things and where it keeps its values. The process an extension runs in hands in
 * pipes and files (`server-runtime.ts`); `createTestServer` hands in memory and a clock a test turns.
 */
import type * as PublicServer from '../../../../packages/extension/server';
import { everyMs, SCHEDULE_NEEDS_CLOCK } from './policy.ts';

type Result<Value> = PublicServer.Result<Value>;

export interface KeyValues {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
}

export interface ServerClock {
    /* `run` settles once the task has, and never rejects, so a test's clock can wait for it. */
    every(ms: number, run: () => Promise<void>): void;
}

/* What `server/` says to the daemon without waiting for an answer. */
export type ServerMessage =
    | { type: 'tool'; name: string; description: string; parameters: unknown }
    | { type: 'subscribe'; name: string }
    | { type: 'emit'; name: string; payload: unknown };

export interface ServerApiOptions {
    dataFolder: string;
    platform: string;
    permissions: ReadonlySet<string>;
    /*
     * The daemon holds what this process does not: the person's agents and chats. It checks the permission too, and
     * its refusal answers as a Result. Only an argument of the wrong shape throws, as the extension's own mistake.
     */
    ask(method: string, args: unknown[]): Promise<Result<unknown>>;
    clock: ServerClock;
    send(message: ServerMessage): void;
    storage: KeyValues;
    secrets: KeyValues;
    log: { info(message: string): void; error(message: string, error?: unknown): void };
}

/* Thrown for a method or tool the extension does not have, which the client reads as `not-found`. */
export class MissingHandler extends Error {}

export interface ServerCore {
    server: typeof PublicServer;
    /* An agent's call of a tool `defineAgentTool` named. */
    runTool(name: string, input: unknown, context: { caller: string }): unknown;
    /* What `defineNodeContext` reads of a node, or nothing for a type without a reader. */
    readNodeContext(nodeType: string, data: unknown): unknown;
    /* Hands a machine event to the listeners of `onEvent`. */
    deliver(name: string, payload: unknown): void;
}

type Listener = (payload: unknown) => void;

interface Ref {
    id: string;
}

function mapResult<Value, Next>(result: Result<Value>, next: (value: Value) => Next): Result<Next> {
    return result.ok ? { ok: true, value: next(result.value) } : result;
}

/* The values of `storage.json` or `secrets.json`, or null for a file that is no JSON object and must not be written over. */
export function parseKeyValues(text: string): Record<string, unknown> | null {
    try {
        const values: unknown = JSON.parse(text);

        return typeof values === 'object' && values !== null && !Array.isArray(values) ? (values as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

/* Only a key that was written: `constructor` or `__proto__` would otherwise answer with what every object has. */
export function ownValue(values: Readonly<Record<string, unknown>>, key: string): unknown {
    return Object.hasOwn(values, key) ? values[key] : undefined;
}

/* A method of the default export of `server/index.ts`, as the client calls it. */
export function callHandler(handlers: Readonly<Record<string, unknown>>, method: string, args: unknown[]): unknown {
    const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined;

    if (typeof handler !== 'function') {
        throw new MissingHandler(`No method ${method}`);
    }

    return (handler as (...values: unknown[]) => unknown)(...args);
}

export function createServerApi(options: ServerApiOptions): ServerCore {
    const { ask, send, permissions } = options;
    const listeners = new Map<string, Set<Listener>>();
    const tools = new Map<string, { run(input: unknown, context: { caller: string }): unknown }>();
    const nodeContexts = new Map<string, (node: { data: unknown }) => unknown>();
    const typed = <Value>(method: string, args: unknown[]) => ask(method, args) as Promise<Result<Value>>;

    const server = {
        machine: {
            platform: options.platform,
            dataFolder: options.dataFolder,
            // An action of the machine in a project, within what the manifest asks for.
            run: <Name extends PublicServer.MachineActionName>(project: Ref, action: Name, input: PublicServer.MachineInput<Name>) =>
                typed<PublicServer.MachineOutput<Name>>('action', [project.id, action, input ?? {}])
        },
        defineLanguageServer: async (languageServer: object) => mapResult(await ask('languages.add', [languageServer]), () => undefined),
        agents: {
            run: (runOptions: { prompt: string; context?: string[]; provider?: string }) => typed<{ text: string }>('agents.run', [runOptions]),
            async start({
                project,
                folder,
                view,
                near,
                prompt,
                provider,
                title,
                hidden
            }: {
                project?: Ref;
                folder?: string;
                view?: Ref;
                near?: Ref[];
                prompt?: string;
                provider?: string;
                title?: string;
                hidden?: boolean;
            }) {
                if ((project === undefined) === (folder === undefined)) {
                    throw new TypeError('agents.start needs a project or a folder, not both');
                }

                const beside = near?.[0]?.id;
                // A chat in another project's folder has no canvas of this one to stand on, and one the extension draws stands on none.
                const placed = folder === undefined && hidden !== true;
                const started = await typed<{ nodeId: string }>('agents.start', [
                    {
                        projectId: project?.id ?? '',
                        ...(folder === undefined ? {} : { folder }),
                        ...(view === undefined || !placed ? {} : { viewId: view.id }),
                        ...(beside === undefined || !placed ? {} : { beside }),
                        ...(prompt === undefined ? {} : { prompt }),
                        ...(provider === undefined ? {} : { provider }),
                        ...(title === undefined ? {} : { title }),
                        ...(hidden === true ? { hidden: true } : {})
                    }
                ]);

                return mapResult(started, ({ nodeId }) => ({ id: nodeId }));
            }
        },
        chats: {
            list: () => typed<PublicServer.ChatSummary[]>('chats.list', []),
            read: (chatId: string) => typed<string>('chats.read', [chatId]),
            send: async (chatId: string, text: string) => mapResult(await ask('chats.send', [chatId, text]), () => undefined)
        },
        defineAgentTool(tool: { id: string; description: string; parameters?: unknown; run(input: never, context: { caller: string }): unknown }): void {
            tools.set(tool.id, tool as { run(input: unknown, context: { caller: string }): unknown });
            send({ type: 'tool', name: tool.id, description: tool.description, parameters: tool.parameters ?? { type: 'object', properties: {} } });
        },
        schedule(task: { id: string; every: string; run(): unknown }): void {
            if (!permissions.has('clock')) {
                throw new Error(SCHEDULE_NEEDS_CLOCK);
            }

            options.clock.every(everyMs(task.every), () =>
                (async () => {
                    await task.run();
                })().catch((e: unknown) => options.log.error(`${task.id} failed:`, e))
            );
        },
        defineServer: <Api extends Record<string, (...args: never[]) => Promise<unknown>>>(api: Api): Api => api,
        onEvent<Name extends keyof PublicServer.ServerEvents>(name: Name, listener: (event: PublicServer.ServerEvents[Name]) => void): () => void {
            const group = listeners.get(name) ?? new Set();
            // The daemon hands on only the payload `ServerEvents` names for this event.
            const heard = listener as Listener;

            group.add(heard);
            listeners.set(name, group);
            send({ type: 'subscribe', name });

            return () => {
                group.delete(heard);
            };
        },
        emit<Payload>(name: string, payload: Payload): void {
            send({ type: 'emit', name, payload });
        },
        defineNodeContext<Data>(nodeType: string, read: (node: { data: Data }) => Promise<{ text: string }[]> | { text: string }[]): void {
            nodeContexts.set(nodeType, read as (node: { data: unknown }) => unknown);
        },
        storage: {
            // What was set under the key, which only the extension knows the shape of.
            get: async <Value>(key: string) => (await options.storage.get(key)) as Value | undefined,
            set: <Value>(key: string, value: Value) => options.storage.set(key, value),
            delete: (key: string) => options.storage.delete(key)
        },
        secrets: {
            get: async (key: string) => (await options.secrets.get(key)) as string | undefined,
            set: (key: string, value: string) => options.secrets.set(key, value)
        },
        log: options.log
        // Held to the public types, so a change to one side breaks the check rather than an extension.
    } satisfies typeof PublicServer;

    return {
        server,
        runTool(name, input, context) {
            const tool = tools.get(name);

            if (tool === undefined) {
                throw new MissingHandler(`No tool ${name}`);
            }

            return tool.run(input, context);
        },
        readNodeContext: (nodeType, data) => nodeContexts.get(nodeType)?.({ data }) ?? [],
        deliver(name, payload) {
            for (const listener of listeners.get(name) ?? []) {
                listener(payload);
            }
        }
    };
}
