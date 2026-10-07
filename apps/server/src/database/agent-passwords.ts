/* A password with the connection it is for and where that connection pointed when it was handed over. */
export interface HandedPassword {
    connectionId: string;
    target: string;
    password: string;
}

function keyOf(connectionId: string, target: string): string {
    return JSON.stringify([connectionId, target]);
}

/*
 * The passwords the clients of a project handed over for its connections, so its agents and its
 * schema snapshots can open a server the way the person's own views do. In memory only: never
 * written, never logged, and gone once the last client lets the project go, or with the daemon. A
 * password answers only for the target it was handed over with, so a connection an agent points
 * elsewhere afterwards gets none.
 */
export class DatabasePasswords {
    // Per project, per client; a newer hand-over from the same client replaces its last one.
    private readonly byProject = new Map<string, Map<string, Map<string, string>>>();

    hand(projectId: string, clientId: string, passwords: readonly HandedPassword[]): void {
        const clients = this.byProject.get(projectId) ?? new Map<string, Map<string, string>>();
        // Deleted first, so the client that spoke last is the one asked first.
        clients.delete(clientId);
        const kept = new Map(
            passwords.filter((entry) => entry.password !== '').map((entry) => [keyOf(entry.connectionId, entry.target), entry.password] as const)
        );
        if (kept.size > 0) {
            clients.set(clientId, kept);
        }
        if (clients.size === 0) {
            this.byProject.delete(projectId);
            return;
        }
        this.byProject.set(projectId, clients);
    }

    /* Null when no client of the project handed one over for this connection as it points now. */
    passwordOf(projectId: string, connectionId: string, target: string): string | null {
        const key = keyOf(connectionId, target);
        const clients = [...(this.byProject.get(projectId)?.values() ?? [])];
        for (const passwords of clients.reverse()) {
            const password = passwords.get(key);
            if (password !== undefined) {
                return password;
            }
        }
        return null;
    }

    forget(projectId: string): void {
        this.byProject.delete(projectId);
    }

    clear(): void {
        this.byProject.clear();
    }
}
