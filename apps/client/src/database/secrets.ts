import type { DatabaseConnection } from '@ruimte/contracts';
import { desktop, type DesktopBridge } from '@/desktop/bridge';

/* How long a password lasts: across restarts in the keychain, until the app quits where the system cannot encrypt, or as long as the page. */
export type SecretPersistence = 'kept' | 'app' | 'page';

/* Where a password is kept: the desktop shell's secret store, or this page's memory where there is none. */
export interface DatabaseSecretStore {
    read(key: string): Promise<string | null>;
    /* Null deletes it. */
    write(key: string, secret: string | null): Promise<void>;
    persistence(): Promise<SecretPersistence>;
}

/* A connection id is only unique within its project, and a project id within its machine. */
export function secretKeyOf(endpointId: string, projectId: string, connectionId: string): string {
    return `${endpointId}/${projectId}/${connectionId}`;
}

/* The password a connection carries, or null for none: an empty field is no password. */
export function passwordOf(connection: DatabaseConnection): string | null {
    const password = connection.config.password;
    return typeof password === 'string' && password !== '' ? password : null;
}

function withoutPassword(connection: DatabaseConnection): DatabaseConnection {
    if (!('password' in connection.config)) {
        return connection;
    }
    const { password: _password, ...config } = connection.config;
    return { ...connection, config: config as DatabaseConnection['config'] };
}

/* The connections as a file may hold them, and the password of each by id. */
export function splitPasswords(connections: readonly DatabaseConnection[]): { connections: DatabaseConnection[]; passwords: Record<string, string> } {
    const passwords: Record<string, string> = {};
    for (const connection of connections) {
        const password = passwordOf(connection);
        if (password !== null) {
            passwords[connection.id] = password;
        }
    }
    return { connections: connections.map(withoutPassword), passwords };
}

/* A saved password and the address it was saved for (`passwordTarget`); null is one saved before addresses were kept, which no connection matches. */
export interface BoundPassword {
    password: string;
    target: string | null;
}

export type SavedPassword = BoundPassword & { target: string };

/* Why a saved password stays out of its connection: the connection points elsewhere now, or the password predates addresses. */
export type WithheldPassword = 'moved' | 'unbound';

const SECRET_VERSION = 1;

/* What the helper takes for a field left out, so leaving it out and writing it are one address. */
const DEFAULT_MYSQL_PORT = 3306;
const DEFAULT_TLS = 'prefer';

/* What a session does once it is in, which sends a password nowhere else. */
const NOT_TARGET = ['password', 'database', 'readOnly', 'create'];

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonical);
    }
    if (typeof value !== 'object' || value === null) {
        return value;
    }
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(entries.map(([key, entry]) => [key, canonical(entry)]));
}

/*
 * Where a connection sends its password and how: the engine, the server or socket, the user, TLS and
 * the tunnel, with the defaults written out. A field this release does not know counts too, since it
 * may lead elsewhere; a password is asked for again rather than sent along.
 */
export function passwordTarget(config: DatabaseConnection['config']): string {
    const fields: Record<string, unknown> = { ...config };
    for (const key of NOT_TARGET) {
        delete fields[key];
    }
    if (config.engine === 'mysql') {
        fields.port ??= DEFAULT_MYSQL_PORT;
        fields.tls ??= DEFAULT_TLS;
        const tunnel = fields.tunnel as Record<string, unknown> | undefined;
        // An SSH port left out is whatever `~/.ssh/config` says for the host, so only the container's has a default.
        if (tunnel?.kind === 'docker') {
            fields.tunnel = { ...tunnel, port: tunnel.port ?? DEFAULT_MYSQL_PORT };
        }
    }
    return JSON.stringify(canonical(fields));
}

/* What the secret store keeps for a connection. */
export function storedSecretOf(password: string, target: string): string {
    return JSON.stringify({ version: SECRET_VERSION, password, target });
}

/* A secret as the store keeps it. One in another shape, such as the bare password of before, is bound to no address. */
export function boundPasswordOf(secret: string): BoundPassword {
    try {
        const parsed = JSON.parse(secret) as Partial<Record<'version' | 'password' | 'target', unknown>> | null;
        if (parsed?.version === SECRET_VERSION && typeof parsed.password === 'string' && typeof parsed.target === 'string') {
            return { password: parsed.password, target: parsed.target };
        }
    } catch {
        // Not JSON: a bare password from before secrets carried their address.
    }
    return { password: secret, target: null };
}

/* Whether a view gets this saved password: a server without one of its own, pointing where the password was saved for. */
export function opensWith(connection: DatabaseConnection, bound: BoundPassword): boolean {
    return (
        connection.config.engine === 'mysql' && passwordOf(connection) === null && bound.target !== null && bound.target === passwordTarget(connection.config)
    );
}

/* The connections as the views open them: each server with its password, where this window knows one saved for where it points. */
export function withPasswords(connections: readonly DatabaseConnection[], passwords: Readonly<Record<string, BoundPassword>>): DatabaseConnection[] {
    return connections.map((connection) => {
        const bound = passwords[connection.id];
        return bound !== undefined && opensWith(connection, bound) ? { ...connection, config: { ...connection.config, password: bound.password } } : connection;
    });
}

/* The servers whose saved password stays out, by id, and why. */
export function withheldPasswords(
    connections: readonly DatabaseConnection[],
    passwords: Readonly<Record<string, BoundPassword>>
): Record<string, WithheldPassword> {
    const withheld: Record<string, WithheldPassword> = {};
    for (const connection of connections) {
        const bound = passwords[connection.id];
        if (bound !== undefined && connection.config.engine === 'mysql' && passwordOf(connection) === null && !opensWith(connection, bound)) {
            withheld[connection.id] = bound.target === null ? 'unbound' : 'moved';
        }
    }
    return withheld;
}

/*
 * The saved passwords after a person's edit. A password in the form is saved for where its connection
 * points as edited, which is how a person takes one along to a new address. One the form never showed,
 * saved for another address, stays for that address; one it showed and the person cleared goes.
 */
export function bindPasswords(
    shown: readonly DatabaseConnection[],
    passwords: Readonly<Record<string, BoundPassword>>,
    next: readonly DatabaseConnection[]
): Record<string, BoundPassword> {
    const before = new Map(shown.map((connection) => [connection.id, connection]));
    const bound: Record<string, BoundPassword> = {};
    for (const connection of next) {
        const typed = passwordOf(connection);
        const saved = passwords[connection.id];
        const was = before.get(connection.id);
        if (typed !== null) {
            bound[connection.id] = { password: typed, target: passwordTarget(connection.config) };
        } else if (saved !== undefined && (was === undefined || !opensWith(was, saved))) {
            bound[connection.id] = saved;
        }
    }
    return bound;
}

/*
 * What the secret store has to be told to hold what the list says: a password that changed, moved or
 * was cleared, and nothing any more for a connection that is no longer in the list.
 */
export function secretWrites(
    stored: Readonly<Record<string, BoundPassword>>,
    passwords: Readonly<Record<string, BoundPassword>>,
    ids: readonly string[]
): { id: string; secret: SavedPassword | null }[] {
    const listed = new Set(ids);
    const writes: { id: string; secret: SavedPassword | null }[] = [];
    for (const id of ids) {
        const next = passwords[id];
        const before = stored[id];
        if (next === undefined) {
            if (before !== undefined) {
                writes.push({ id, secret: null });
            }
        } else if (next.target !== null && (before?.password !== next.password || before.target !== next.target)) {
            writes.push({ id, secret: { password: next.password, target: next.target } });
        }
    }
    for (const id of Object.keys(stored)) {
        if (!listed.has(id)) {
            writes.push({ id, secret: null });
        }
    }
    return writes;
}

export function memorySecretStore(): DatabaseSecretStore {
    const secrets = new Map<string, string>();
    return {
        read: async (key) => secrets.get(key) ?? null,
        write: async (key, secret) => {
            if (secret === null) {
                secrets.delete(key);
            } else {
                secrets.set(key, secret);
            }
        },
        persistence: async () => 'page'
    };
}

/* Without the shell (the web client) a password lasts as long as the page: never in storage a page can read back later. */
const pageMemory = memorySecretStore();

export function databaseSecretStore(bridge: DesktopBridge | null = desktop()): DatabaseSecretStore {
    const secrets = bridge?.databaseSecrets;
    if (secrets === undefined) {
        return pageMemory;
    }
    return {
        read: (key) => secrets.read(key),
        write: (key, secret) => secrets.write(key, secret),
        persistence: async () => {
            // A shell from before it could say keeps them in the keychain wherever the system lets it.
            const persistent = (await secrets.persistent?.()) ?? true;
            return persistent ? 'kept' : 'app';
        }
    };
}
