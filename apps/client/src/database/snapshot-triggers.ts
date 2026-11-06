import type { DatabaseConnection } from '@ruimte/contracts';
import { passwordTarget } from '@/database/secrets';
import { fireAndForget } from '@/transport-api/transport';

/* A request of the database views and what the machine answered, as the workspace's client sends and receives them. */
interface Exchange {
    request: { method?: unknown; params?: unknown };
    response: { ok?: unknown; result?: unknown };
}

/*
 * The schema list can stay cached while its tables change, so both reads refresh SQL analysis.
 * A table list arriving during a snapshot may be newer than that snapshot and needs one follow-up.
 */
export function snapshotTrigger(connections: () => readonly DatabaseConnection[], refresh: (connectionId: string) => Promise<void>) {
    const sessions = new Map<string, string[]>();
    const running = new Set<string>();
    const pending = new Set<string>();

    const ask = (connectionId: string, tables = false): void => {
        if (running.has(connectionId)) {
            if (tables) {
                pending.add(connectionId);
            }
            return;
        }
        running.add(connectionId);
        void fireAndForget('refresh', refresh(connectionId)).finally(() => {
            running.delete(connectionId);
            if (pending.delete(connectionId)) {
                ask(connectionId);
            }
        });
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
        } else if (request.method === 'schemas' || request.method === 'tables') {
            for (const id of sessions.get(params.session) ?? []) {
                ask(id, request.method === 'tables');
            }
        }
    };
}
