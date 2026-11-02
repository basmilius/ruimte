/** What the client can call. The default export of `server/index.ts`. */
export function defineServer<Api extends Record<string, (...args: never[]) => Promise<unknown>>>(api: Api): Api;

/**
 * A machine event, such as `chat.status`. A `chat.*` event needs the `chats.read` permission and a `session.*` event
 * `terminals.read`; any other name is refused. Set `"autostart": true` to follow them with no client open.
 */
export function onEvent(name: string, listener: (payload: unknown) => void): () => void;

/** Says something to every client of this machine. */
export function emit(name: string, payload: unknown): void;

/** What an agent reads of a node along a line, also with no client open. */
export function defineNodeContext<Data>(nodeType: string, read: (node: { data: Data }) => Promise<{ text: string }[]> | { text: string }[]): void;

/**
 * Needs `agents.tools`. Any agent on this machine can then find it with `ruimte-context tool list` and call it with `tool run`.
 * Having it starts `server/` with the machine, since an agent can only find what is running. It answers in text.
 */
export function defineAgentTool(tool: { id: string; description: string; parameters?: object; run(input: any, context: { caller: string }): string | Promise<string> }): void;

/** Needs the permission `clock`. Runs on this process's own clock: `every` is like 30s, 5m or 1h, of at least 10 seconds. */
export function schedule(task: { id: string; every: string; run(): void | Promise<void> }): void;

export const agents: {
    /** Needs `agents.run`. */
    run(options: { prompt: string; context?: string[]; provider?: string }): Promise<{ text: string }>;
    /** Needs `agents.start`. A chat a person sees, supervised at most: on the canvas of `viewId`, or a view of its own in the sidebar without one. */
    start(options: { projectId: string; prompt?: string; provider?: string; title?: string; viewId?: string; beside?: string }): Promise<{ nodeId: string }>;
};

export const chats: {
    /** Needs `chats.read`. */
    list(): Promise<unknown[]>;
    /** Needs `chats.send`. Wakes the chat. At most 20 messages per chat per hour. */
    send(chatId: string, text: string): Promise<void>;
};

export const storage: {
    get<Value>(key: string): Promise<Value | undefined>;
    set(key: string, value: unknown): Promise<void>;
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
    /** An action of the machine in a project, such as launch.start, within what your manifest asks for. */
    run(projectId: string, action: string, input?: object): Promise<any>;
};

/** Needs `languages.servers`. Adds a server, listed in Settings like one a person added, and started without asking: installing the extension was the approval. Calling it again with the same name changes it, and removing the extension removes it unless a person edited it. Rejects when the command is not on this machine. */
export function defineLanguageServer(server: { name: string; command: string; args?: string[]; env?: Record<string, string>; languages: string[]; patterns: string[] }): Promise<void>;

export const log: {
    info(message: string): void;
    error(message: string, error?: unknown): void;
};
