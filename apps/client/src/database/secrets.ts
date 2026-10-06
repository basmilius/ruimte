import type { DatabaseConnection } from '@ruimte/contracts';
import { desktop, type DesktopBridge } from '@/desktop/bridge';

/* Where a password is kept: the desktop shell's secret store, or this page's memory where there is none. */
export interface DatabaseSecretStore {
    read(key: string): Promise<string | null>;
    /* Null deletes it. */
    write(key: string, secret: string | null): Promise<void>;
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

/* The connections as the views open them: each server with its password, where this window knows one. A file has none. */
export function withPasswords(connections: readonly DatabaseConnection[], passwords: Readonly<Record<string, string>>): DatabaseConnection[] {
    return connections.map((connection) => {
        const password = passwords[connection.id];
        return password === undefined || connection.config.engine !== 'mysql' || passwordOf(connection) !== null
            ? connection
            : { ...connection, config: { ...connection.config, password } };
    });
}

/*
 * What the secret store has to be told to hold what the list says: a password that changed or was
 * cleared, and nothing any more for a connection that is no longer in the list.
 */
export function secretWrites(
    stored: Readonly<Record<string, string>>,
    passwords: Readonly<Record<string, string>>,
    ids: readonly string[]
): { id: string; secret: string | null }[] {
    const listed = new Set(ids);
    const writes: { id: string; secret: string | null }[] = [];
    for (const id of ids) {
        const secret = passwords[id] ?? null;
        if ((stored[id] ?? null) !== secret) {
            writes.push({ id, secret });
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
        }
    };
}

/* Without the shell (the web client) a password lasts as long as the page: never in storage a page can read back later. */
const pageMemory = memorySecretStore();

export function databaseSecretStore(bridge: DesktopBridge | null = desktop()): DatabaseSecretStore {
    return bridge?.databaseSecrets ?? pageMemory;
}
