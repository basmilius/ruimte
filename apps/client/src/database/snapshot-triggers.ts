import type { DatabaseConnection } from '@ruimte/contracts';
import { passwordTarget } from '@/database/secrets';

/* A request of the database views and what the machine answered, as the workspace's client sends and receives them. */
interface Exchange {
    request: { method?: unknown; params?: unknown };
    response: { ok?: unknown; result?: unknown };
}

/*
 * When the machine should take the schema snapshots of a connection again: when its tree is read, which
 * is a `schemas` on one of its sessions as the explorer opens or refreshes it. Which connection a session
 * is comes from the `open` that made it, matched on where the connection points. A connection whose
 * snapshot is being taken is not asked again until that one answered.
 */
export function snapshotTrigger(connections: () => readonly DatabaseConnection[], refresh: (connectionId: string) => Promise<void>) {
    const sessions = new Map<string, string[]>();
    const running = new Set<string>();

    const ask = (connectionId: string): void => {
        if (running.has(connectionId)) {
            return;
        }
        running.add(connectionId);
        void refresh(connectionId)
            .catch(() => undefined)
            .finally(() => running.delete(connectionId));
    };

    return ({ request, response }: Exchange): void => {
        if (response.ok !== true) {
            return;
        }
        const params = (request.params ?? {}) as { session?: unknown; connection?: DatabaseConnection['config'] };
        if (request.method === 'open' && params.connection !== undefined) {
            const session = (response.result as { session?: unknown } | null)?.session;
            const target = passwordTarget(params.connection);
            const ids = connections()
                .filter((connection) => passwordTarget(connection.config) === target)
                .map((connection) => connection.id);
            if (typeof session === 'string' && ids.length > 0) {
                sessions.set(session, ids);
            }
            return;
        }
        if (typeof params.session !== 'string') {
            return;
        }
        if (request.method === 'close') {
            sessions.delete(params.session);
        } else if (request.method === 'schemas') {
            for (const id of sessions.get(params.session) ?? []) {
                ask(id);
            }
        }
    };
}
