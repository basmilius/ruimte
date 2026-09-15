import type { Endpoint } from '@/state/endpoints';
import type { ConnectionState } from '@/transport/transport';

/*
 * Longer than any attempt that ends with a reason of its own (a direct connection gives up after 20
 * seconds, an address that does not resolve after 20 as well), so a reason always wins from this.
 */
const ENSURE_TIMEOUT_MS = 45_000;

export interface MachineLinkDeps {
    /* The row this client keeps for a machine, under its own id or the daemon id it answered with. */
    rowFor(id: string): Endpoint | null;
    /* Makes the row for a machine only the account knows, or throws why it cannot be reached. */
    createRow(id: string): Endpoint;
    connection(endpointId: string): ConnectionState;
    hold(endpoint: Endpoint): () => void;
    subscribe(endpointId: string, handler: () => void): () => void;
    reconnect(endpointId: string): void;
    timeoutMs?: number;
}

/*
 * Brings a machine's link up on demand, whichever way in asked: the palette, a project in the
 * switcher, a folder, the welcome screen of the web client. A machine this client has no row for
 * yet gets one here, the way the account list makes one. The wait ends on the first attempt that
 * fails, with its reason, rather than sitting through the reconnect loop behind it; that loop keeps
 * running, so the machine may still come up later without anyone asking again.
 */
export class MachineLinks {
    private readonly deps: MachineLinkDeps;
    private readonly attempts = new Map<string, Promise<string>>();

    constructor(deps: MachineLinkDeps) {
        this.deps = deps;
    }

    /* Resolves with the id of the row once its link is open, or rejects with a reason a person can read. */
    ensure(id: string): Promise<string> {
        const known = this.deps.rowFor(id);
        if (known && this.deps.connection(known.id).status === 'open') {
            return Promise.resolve(known.id);
        }
        const key = known?.id ?? id;
        const running = this.attempts.get(key);
        if (running) {
            return running;
        }
        const attempt = this.attempt(id).finally(() => {
            this.attempts.delete(key);
        });
        this.attempts.set(key, attempt);
        return attempt;
    }

    private async attempt(id: string): Promise<string> {
        const row = this.deps.rowFor(id) ?? this.deps.createRow(id);
        const release = this.deps.hold(row);
        try {
            await this.waitForOpen(row.id);
            // A row that answered as a daemon it already knew moved onto that id while it came up.
            return this.deps.rowFor(id)?.id ?? row.id;
        } finally {
            release();
        }
    }

    private waitForOpen(endpointId: string): Promise<void> {
        const { deps } = this;
        return new Promise((resolve, reject) => {
            let settled = false;
            let off: () => void = () => undefined;
            const finish = (failure: string | null): void => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                off();
                if (failure === null) {
                    resolve();
                } else {
                    reject(new Error(failure));
                }
            };
            const check = (): void => {
                const state = deps.connection(endpointId);
                if (state.status === 'open') {
                    finish(null);
                } else if (state.status === 'closed') {
                    finish(state.failure ?? 'That machine is not answering');
                }
            };
            const timer = setTimeout(() => finish('That machine is not answering'), deps.timeoutMs ?? ENSURE_TIMEOUT_MS);
            off = deps.subscribe(endpointId, check);
            // A link waiting out its backoff is tried now: a person just asked for this machine.
            if (deps.connection(endpointId).status === 'closed') {
                deps.reconnect(endpointId);
            }
            check();
        });
    }
}
