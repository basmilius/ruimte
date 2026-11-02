/*
 * `createTestServer` of `@ruimte/extension/testing`: an extension's `server/index.ts` in the test's own process, on the
 * same `createServerApi` and policy as the machine, with memory for files, a clock the test turns and answers it scripts.
 */
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type * as PublicServer from '../../../../packages/extension/server';
import type * as PublicTesting from '../../../../packages/extension/testing';
import { askRefusal, eventRefusal, permissionsOf, SendLimit, type Refusal } from './policy.ts';
import { callHandler, createServerApi, MissingHandler, type KeyValues, type ServerCore, type ServerMessage } from './server-api.ts';

type Result<Value> = PublicServer.Result<Value>;
type Json = PublicServer.Json;
type Ask = PublicTesting.TestAsk;
type Answers = PublicTesting.TestServerAnswers;

const DURATION_UNITS: Readonly<Record<string, number>> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

class TestRefusal extends Error {
    readonly code: PublicServer.ExtensionErrorCode;

    constructor(code: PublicServer.ExtensionErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}

export function refusal(code: PublicServer.ExtensionErrorCode, message: string): Error {
    return new TestRefusal(code, message);
}

/* As it crosses the pipe to the machine and back, so a value JSON cannot carry fails here and not only in Ruimte. */
function wire<Value>(value: unknown): Value {
    return JSON.parse(JSON.stringify(value ?? null)) as Value;
}

function failure(code: PublicServer.ExtensionErrorCode, message: string): Result<never> {
    return { ok: false, error: { code, message } };
}

function durationMs(duration: string | number): number {
    if (typeof duration === 'number') {
        return duration;
    }

    const match = /^(\d+)(ms|s|m|h)$/.exec(duration);

    if (match === null) {
        throw new TypeError(`advance takes milliseconds or something like 30s, 5m or 1h, not ${duration}`);
    }

    return Number(match[1]) * (DURATION_UNITS[match[2] as string] as number);
}

function manifestIn(folder: string): { id?: string; permissions?: Record<string, string> } {
    try {
        return JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as { id?: string; permissions?: Record<string, string> };
    } catch {
        return {};
    }
}

function memory(values: Record<string, unknown>): KeyValues {
    return {
        get: async (key) => (Object.hasOwn(values, key) ? wire(values[key]) : undefined),
        set: async (key, value) => {
            values[key] = wire(value);
        },
        delete: async (key) => {
            delete values[key];
        }
    };
}

/* The wire's `agents.start` back in the words of the API, as an answer reads it. */
function startOptions(start: { projectId: string; viewId?: string; beside?: string; prompt?: string; provider?: string; title?: string }) {
    return {
        project: { id: start.projectId },
        ...(start.viewId === undefined ? {} : { view: { id: start.viewId } }),
        ...(start.beside === undefined ? {} : { near: [{ id: start.beside }] }),
        ...(start.prompt === undefined ? {} : { prompt: start.prompt }),
        ...(start.provider === undefined ? {} : { provider: start.provider }),
        ...(start.title === undefined ? {} : { title: start.title })
    };
}

interface Scheduled {
    every: number;
    due: number;
    run(): Promise<void>;
}

/* One machine of a test: what `server/` was given, and what it did with it. */
class TestMachine {
    readonly id: string;
    readonly storage: Record<string, Json>;
    readonly secrets: Record<string, string>;
    readonly emitted: { name: string; payload: Json }[] = [];
    readonly asked: Ask[] = [];
    readonly languageServers: object[] = [];
    readonly logs: string[] = [];
    readonly core: ServerCore;

    private readonly permissions: ReadonlySet<string>;
    private readonly answers: Answers;
    private readonly subscriptions = new Set<string>();
    private readonly tools = new Map<string, boolean>();
    private readonly scheduled: Scheduled[] = [];
    private readonly sends: SendLimit;
    private now = 0;

    constructor(options: PublicTesting.TestServerOptions, folder: string) {
        const manifest = { ...manifestIn(folder), ...options.manifest };

        this.id = manifest.id ?? 'test.extension';
        this.permissions = permissionsOf(manifest);
        this.answers = options.answers ?? {};
        this.storage = wire(options.storage ?? {});
        this.secrets = { ...options.secrets };
        this.sends = new SendLimit(() => this.now);
        this.core = createServerApi({
            dataFolder: join(tmpdir(), `ruimte-extension-test-${this.id}`),
            platform: process.platform,
            permissions: this.permissions,
            ask: (method, args) => this.ask(method, args),
            clock: {
                every: (every, run) => {
                    this.scheduled.push({ every, due: this.now + every, run });
                }
            },
            send: (message) => this.said(message),
            storage: memory(this.storage),
            secrets: memory(this.secrets),
            log: {
                info: (message) => void this.logs.push(message),
                error: (message, error) =>
                    void this.logs.push(error === undefined ? message : `${message} ${error instanceof Error ? error.message : String(error)}`)
            }
        });
    }

    clockNow(): number {
        return this.now;
    }

    async advance(duration: string | number): Promise<void> {
        const until = this.now + durationMs(duration);

        for (let next = this.nextDue(until); next !== null; next = this.nextDue(until)) {
            this.now = next.due;
            next.due += next.every;
            await next.run();
        }

        this.now = until;
    }

    private nextDue(until: number): Scheduled | null {
        const due = this.scheduled.filter((task) => task.due <= until).sort((left, right) => left.due - right.due);

        return due[0] ?? null;
    }

    fire(name: string, payload: unknown): void {
        if (this.subscriptions.has(name)) {
            this.core.deliver(name, wire(payload));
        }
    }

    async runTool(id: string, input: object, caller: string): Promise<string> {
        if (this.tools.get(id) !== true) {
            const missing = `No tool ${this.id}/${id}. ruimte-context tool list says what there is`;

            throw new Error(this.tools.has(id) ? `${missing}. defineAgentTool needs the permission agents.tools in manifest.json` : missing);
        }

        const answer = await this.core.runTool(id, wire(input), { caller });

        return typeof answer === 'string' ? answer : JSON.stringify(answer);
    }

    private said(message: ServerMessage): void {
        if (message.type === 'emit') {
            this.emitted.push({ name: message.name, payload: wire(message.payload) });
        } else if (message.type === 'tool') {
            // The machine lists a tool only with the permission, and says nothing of one without it.
            this.tools.set(message.name, this.permissions.has('agents.tools'));
        } else {
            const reason = eventRefusal(message.name, this.permissions);

            if (reason === null) {
                this.subscriptions.add(message.name);
            } else {
                this.logs.push(reason);
            }
        }
    }

    /* What the host answers an ask, in its order: the permission, an answer at all, the sends of the hour, then the answer. */
    private async ask(method: string, args: unknown[]): Promise<Result<unknown>> {
        const refused = askRefusal(this.id, method, args, this.permissions);
        const [name, recorded] = this.named(method, args);
        const result = refused === null ? await this.answer(method, args) : this.refused(method, refused);

        this.asked.push({ method: name, args: wire(recorded), result });

        return result;
    }

    private refused(method: string, { code, message }: Refusal): Result<never> {
        this.logs.push(`${method} answered ${code}: ${message}`);

        return failure(code, message);
    }

    private named(method: string, args: unknown[]): [Ask['method'], unknown[]] {
        if (method === 'action') {
            return ['machine.run', [{ id: args[0] }, args[1], args[2]]];
        }

        if (method === 'languages.add') {
            return ['defineLanguageServer', args];
        }

        if (method === 'agents.start') {
            return ['agents.start', [startOptions(args[0] as Parameters<typeof startOptions>[0])]];
        }

        return [method as Ask['method'], args];
    }

    private async answer(method: string, args: unknown[]): Promise<Result<unknown>> {
        if (method === 'languages.add') {
            this.languageServers.push(wire(args[0]));

            return { ok: true, value: null };
        }

        const answer = this.scripted(method, args);

        if (answer === null) {
            return this.refused(method, { code: 'unavailable', message: `Nothing answers ${method} in this test. Give it under answers` });
        }

        if (method === 'chats.send') {
            const limited = this.sends.take(this.id, String(args[0]));

            if (limited !== null) {
                return this.refused(method, limited);
            }
        }

        try {
            const value = await answer();

            return { ok: true, value: wire(method === 'agents.start' ? { nodeId: (value as PublicServer.NodeRef).id } : value) };
        } catch (e) {
            if (e instanceof TestRefusal) {
                return this.refused(method, { code: e.code, message: e.message });
            }

            return this.refused(method, { code: 'failed', message: e instanceof Error ? e.message : String(e) });
        }
    }

    private scripted(method: string, args: unknown[]): (() => unknown) | null {
        const answers = this.answers as Record<string, ((...values: unknown[]) => unknown) | undefined>;

        if (method === 'action') {
            const [projectId, action, input] = args as [string, string, unknown];
            const run = (
                this.answers['machine.run'] as Record<string, ((input: unknown, project: PublicServer.ProjectRef) => unknown) | undefined> | undefined
            )?.[action];

            return run === undefined ? null : () => run(wire(input), { id: projectId });
        }

        const run = answers[method];

        if (run === undefined) {
            return null;
        }

        return method === 'agents.start' ? () => run(startOptions(args[0] as Parameters<typeof startOptions>[0])) : () => run(...wire<unknown[]>(args));
    }
}

let current: TestMachine | null = null;
let loads = 0;

/* The machine `@ruimte/extension/server` speaks for: the test server created last, or one of the manifest alone outside of one. */
export function currentServer(): typeof PublicServer {
    current ??= new TestMachine({}, process.cwd());

    return current.core.server;
}

export async function createTestServer<Api>(options: PublicTesting.TestServerOptions = {}): Promise<PublicTesting.TestServer<Api>> {
    const folder = process.cwd();
    const machine = new TestMachine(options, folder);

    loads += 1;
    current = machine;

    // A fresh copy of the entry each time, so what it defines at the top lands on this machine.
    const module = (await import(`${resolve(folder, options.entry ?? join('server', 'index.ts'))}?ruimte-test=${loads}`)) as {
        default?: Record<string, unknown>;
    };
    const handlers = module.default ?? {};

    const call = async (method: string, ...args: unknown[]): Promise<Result<unknown>> => {
        try {
            return { ok: true, value: wire(await callHandler(handlers, method, wire(args))) };
        } catch (e) {
            return failure(e instanceof MissingHandler ? 'not-found' : 'failed', e instanceof Error ? e.message : String(e));
        }
    };

    return {
        // Typed by the author's `Api`, which only the default export of `server/index.ts` holds to.
        call: call as unknown as PublicTesting.TestServer<Api>['call'],
        storage: machine.storage,
        secrets: machine.secrets,
        clock: { now: () => machine.clockNow(), advance: (duration) => machine.advance(duration) },
        fire: (name, payload) => machine.fire(name, payload),
        emitted: machine.emitted,
        asked: machine.asked,
        languageServers: machine.languageServers,
        logs: machine.logs,
        tool: (id) => ({ run: (input = {}, context = {}) => machine.runTool(id, input, context.caller ?? 'test') }),
        nodeContext: async (nodeType, data) => wire(await machine.core.readNodeContext(nodeType, wire(data)))
    };
}
