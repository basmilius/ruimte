import type { MachineActionName, MachineInput, MachineOutput } from './client';

export type { MachineActionName, MachineActions, MachineInput, MachineOutput } from './client';

/**
 * Why a call came back without its answer. `permission-denied`: the manifest does not ask for the permission. `no-project`: no
 * project with a folder is open. `no-canvas`: no canvas is in front. `not-found`: what it names is not there. `outside-project`: a
 * path leaves the project folder. `refused`: the machine or the person said no. `limit`: too many calls in a while. `timeout`: no
 * answer in time. `unavailable`: the machine, or `server/`, cannot answer now. `failed`: anything else, with its message.
 */
export type ExtensionErrorCode =
    | 'permission-denied'
    | 'no-project'
    | 'no-canvas'
    | 'not-found'
    | 'outside-project'
    | 'refused'
    | 'limit'
    | 'timeout'
    | 'unavailable'
    | 'failed';

/**
 * What a call that can fail answers: its value, or why not. Only a wrong argument throws. A call with nothing to answer,
 * a `Result<void>`, answers `{ ok: true, value: undefined }` with the key `value` there.
 */
export type Result<Value, Code extends string = ExtensionErrorCode> = { ok: true; value: Value } | { ok: false; error: { code: Code; message: string } };

/** A value as it crosses to the machine and back. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined };

export interface NodeRef {
    id: string;
}

export interface ViewRef {
    id: string;
}

export interface ProjectRef {
    id: string;
}

/** Where an agent is, the same word everywhere it shows. */
export type AgentStatus = 'idle' | 'running' | 'needsYou' | 'stopped';

/** A chat on the machine, as `chats.list` answers it. Its id is the id of its node. */
export interface ChatSummary {
    id: string;
    provider: string;
    status: AgentStatus;
    model: string | null;
    cwd: string;
}

/** What the client can call. The default export of `server/index.ts`. A method that throws reaches the client as `failed`, with its message. */
export function defineServer<Api extends Record<string, (...args: never[]) => Promise<unknown>>>(api: Api): Api;

/** The machine's events `server/` can follow, with what each says. */
export interface ServerEvents {
    /** A chat changed what it is doing. Needs `chats.read`. */
    'chat.status': { chat: ChatSummary };
    /** Something new in a chat's thread; `chats.read` reads it. Needs `chats.read`. */
    'chat.event': { chatId: string };
    /** The agent in a terminal changed what it is doing. Needs `terminals.read`. */
    'session.status': { nodeId: string; status: AgentStatus };
}

/** Follows a machine event, behind its permission; any other name is refused. Set `"autostart": true` to follow them with no client open. */
export function onEvent<Name extends keyof ServerEvents>(name: Name, listener: (event: ServerEvents[Name]) => void): () => void;

/** Says something to every client of this machine, where `useServerEvent(name)` hears `payload`, or undefined without one. */
export function emit<Payload>(name: string, payload?: Payload): void;

/** What an agent reads of a node along a line, also with no client open. */
export function defineNodeContext<Data>(nodeType: string, read: (node: { data: Data }) => Promise<{ text: string }[]> | { text: string }[]): void;

/**
 * Needs `agents.tools`. Any agent on this machine can then find it with `ruimte-context tool list` and call it with `tool run`.
 * Having it starts `server/` with the machine, since an agent can only find what is running. It answers in text. Type `Input`
 * after `parameters`, a JSON Schema.
 */
export function defineAgentTool<Input extends object = { [key: string]: Json | undefined }>(tool: {
    id: string;
    description: string;
    parameters?: object;
    run(input: Input, context: { caller: string }): string | Promise<string>;
}): void;

/** Needs the permission `clock`. Runs on this process's own clock: `every` is like 30s, 5m or 1h, of at least 10 seconds and at most 596 hours. */
export function schedule(task: { id: string; every: string; run(): void | Promise<void> }): void;

export const agents: {
    /** Needs `agents.run`. One hidden prompt on a CLI of the person, with the answer whole. */
    run(options: { prompt: string; context?: string[]; provider?: string }): Promise<Result<{ text: string }>>;
    /** Needs `agents.start`. A chat a person sees, supervised at most: on the canvas `view`, beside `near`, or a view of its own in the sidebar without one. */
    start(options: { project: ProjectRef; view?: ViewRef; near?: NodeRef[]; prompt?: string; provider?: string; title?: string }): Promise<Result<NodeRef>>;
};

/** `list` and `read` need `chats.read`, `send` needs `chats.send`. */
export const chats: {
    list(): Promise<Result<ChatSummary[]>>;
    /** The thread as text, as an agent reads it. */
    read(chatId: string): Promise<Result<string>>;
    /** Wakes the chat. At most 20 messages per chat per hour, past which it answers `limit`. */
    send(chatId: string, text: string): Promise<Result<void>>;
};

export const storage: {
    get<Value>(key: string): Promise<Value | undefined>;
    set<Value>(key: string, value: Value): Promise<void>;
    delete(key: string): Promise<void>;
};

/** Kept readable only by the person who runs the machine. */
export const secrets: {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
};

export const machine: {
    platform: string;
    dataFolder: string;
    /** An action of the machine in a project, such as `launch.start`, within what your manifest asks for. */
    run<Name extends MachineActionName>(project: ProjectRef, action: Name, input: MachineInput<Name>): Promise<Result<MachineOutput<Name>>>;
};

/**
 * Needs `languages.servers`. Adds a server, listed in Settings like one a person added, and started without asking: installing the extension
 * was the approval. Calling it again with the same name changes it, and removing the extension removes it unless a person edited it.
 */
export function defineLanguageServer(server: {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    languages: string[];
    patterns: string[];
}): Promise<Result<void>>;

export const log: {
    info(message: string): void;
    /** `error` is what a `catch` caught, of any shape. */
    error(message: string, error?: unknown): void;
};
