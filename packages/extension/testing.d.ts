import type { ComponentType } from 'react';
import type { SlotAnswer, SlotName } from './client';
import type {
    ChatSummary,
    ExtensionErrorCode,
    Json,
    MachineActionName,
    MachineInput,
    MachineOutput,
    NodeRef,
    ProjectRef,
    Result,
    ServerEvents,
    ViewRef
} from './server';

/** What `client/index.ts` defined so far, in order, with the object each `define*` was given. Available under `ruimte extension test`. */
export function definitions(): { kind: string; definition: object }[];

/** What a slot of an action, menu or widget answers for this context. */
export function slotAnswer(definition: { slots?: object }, slot: SlotName, context: object): SlotAnswer;

/** Draws a component to a string, with `server` standing in for `server/`: its methods answer as `useServer` would, a throw as `failed`. */
export function renderSurface<Props extends object>(
    component: ComponentType<Props>,
    options?: { server?: Record<string, (...args: never[]) => unknown>; data?: object; props?: Props }
): string;

type Answer<Value> = Value | Promise<Value>;

/**
 * What the machine answers `server/` in a test. Each answer gets what `server/` asked and returns the value; throw `refusal(code, message)`
 * to answer a failure. A call nothing answers is `unavailable`.
 */
export interface TestServerAnswers {
    'agents.run'?(options: { prompt: string; context?: string[]; provider?: string }): Answer<{ text: string }>;
    /** `near` holds only the first node, as the machine only uses that one. */
    'agents.start'?(options: { project: ProjectRef; view?: ViewRef; near?: NodeRef[]; prompt?: string; provider?: string; title?: string }): Answer<NodeRef>;
    'chats.list'?(): Answer<ChatSummary[]>;
    'chats.read'?(chatId: string): Answer<string>;
    'chats.send'?(chatId: string, text: string): Answer<void>;
    'machine.run'?: { [Name in MachineActionName]?: (input: MachineInput<Name>, project: ProjectRef) => Answer<MachineOutput<Name>> };
}

export interface TestServerOptions {
    /** Over `manifest.json` in the folder the test runs in, such as `{ permissions: {} }` to take every permission away. */
    manifest?: { id?: string; permissions?: Record<string, string> };
    /** `server/index.ts` by default. */
    entry?: string;
    storage?: Record<string, Json>;
    secrets?: Record<string, string>;
    answers?: TestServerAnswers;
}

/** A call of `server/` to the machine, with what it was answered. */
export interface TestAsk {
    method: 'agents.run' | 'agents.start' | 'chats.list' | 'chats.read' | 'chats.send' | 'machine.run' | 'defineLanguageServer';
    args: Json[];
    result: Result<unknown>;
}

type Method<Api, Name extends keyof Api> = Api[Name] extends (...args: infer Args) => Promise<infer Value> ? (...args: Args) => Promise<Result<Value>> : never;

export interface TestServer<Api> {
    /** Calls a method of `server/index.ts` as the client does: its arguments and answer cross as JSON, a throw answers `failed`. */
    call<Name extends keyof Api & string>(method: Name, ...args: Parameters<Method<Api, Name>>): ReturnType<Method<Api, Name>>;
    /** What `storage` and `secrets` hold now, changed in place. */
    storage: Record<string, Json>;
    secrets: Record<string, string>;
    /** A clock of its own, from 0: `advance('5m')` runs every `schedule` task that falls due on the way, in order, and waits for each. */
    clock: { now(): number; advance(duration: string | number): Promise<void> };
    /** Hands a machine event to `onEvent`, if the manifest has its permission, as the machine would. */
    fire<Name extends keyof ServerEvents>(name: Name, payload: ServerEvents[Name]): void;
    /** What `emit` said, in order. */
    emitted: { name: string; payload: Json }[];
    /** What `server/` asked the machine, in order. */
    asked: TestAsk[];
    /** What `defineLanguageServer` added. */
    languageServers: object[];
    /** What `log` wrote, and every refusal, as `ruimte extension dev` prints it. */
    logs: string[];
    /** An agent's call of a tool `defineAgentTool` named, by the id it gave, answered in text. */
    tool(id: string): { run(input?: object, context?: { caller?: string }): Promise<string> };
    /** What an agent reads of a node of this type along a line. */
    nodeContext(nodeType: string, data: Json): Promise<{ text: string }[]>;
}

/**
 * Loads `server/index.ts` in this process, against the machine of a test: storage in memory, answers you script and the permissions of
 * your manifest, refused with the messages and codes Ruimte gives. `@ruimte/extension/server` speaks for the test server created last.
 * A file `server/index.ts` imports runs once, and keeps its state between test servers.
 */
export function createTestServer<Api = Record<string, (...args: never[]) => Promise<unknown>>>(options?: TestServerOptions): Promise<TestServer<Api>>;

/** A failure for an answer to throw, which `server/` reads as a Result under `code`. */
export function refusal(code: ExtensionErrorCode, message: string): Error;
