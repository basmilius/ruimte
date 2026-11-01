/** What the client can call. The default export of `server/index.ts`. */
export function defineServer<Api extends Record<string, (...args: never[]) => Promise<unknown>>>(api: Api): Api;

/** A machine event, such as `chat.status`. Set `"autostart": true` to follow them with no client open. */
export function onEvent(name: string, listener: (payload: unknown) => void): () => void;

/** Says something to every client of this machine. */
export function emit(name: string, payload: unknown): void;

/** What an agent reads of a node along a line, also with no client open. */
export function defineNodeContext<Data>(nodeType: string, read: (node: { data: Data }) => Promise<{ text: string }[]> | { text: string }[]): void;

export const storage: {
    get<Value>(key: string): Promise<Value | undefined>;
    set(key: string, value: unknown): Promise<void>;
};

/** Kept readable only by the person who runs the machine. */
export const secrets: {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
};

export const log: {
    info(message: string): void;
    error(message: string, error?: unknown): void;
};
