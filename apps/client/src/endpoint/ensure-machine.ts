import i18next from 'i18next';
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
/* The one error a wait ends on when the person who asked stopped waiting, so a caller can tell it from a failure. */
export class MachineWaitCancelled extends Error {
    constructor() {
        super(i18next.t('machines:link.cancelled'));
        this.name = 'MachineWaitCancelled';
    }
}

interface Attempt {
    promise: Promise<string>;
    controller: AbortController;
    /* Callers that may still stop waiting; the attempt, and with it the hold, ends when the last one does. */
    waiters: number;
    /* A caller without a signal never stops waiting, so nobody can end the attempt under it. */
    pinned: boolean;
}

export class MachineLinks {
    private readonly deps: MachineLinkDeps;
    private readonly attempts = new Map<string, Attempt>();

    constructor(deps: MachineLinkDeps) {
        this.deps = deps;
    }

    /*
     * Resolves with the id of the row once its link is open, or rejects with a reason a person can
     * read. A signal that aborts rejects this call with `MachineWaitCancelled`, and lets go of the hold
     * once no other caller is waiting on the same attempt.
     */
    ensure(id: string, signal?: AbortSignal): Promise<string> {
        if (signal?.aborted) {
            return Promise.reject(new MachineWaitCancelled());
        }
        const known = this.deps.rowFor(id);
        if (known && this.deps.connection(known.id).status === 'open') {
            return Promise.resolve(known.id);
        }
        const key = known?.id ?? id;
        const attempt = this.attempts.get(key) ?? this.start(key, id);
        if (!signal) {
            attempt.pinned = true;
            return attempt.promise;
        }
        attempt.waiters += 1;
        return new Promise((resolve, reject) => {
            const onAbort = (): void => {
                attempt.waiters -= 1;
                if (attempt.waiters === 0 && !attempt.pinned) {
                    // Forgotten now rather than when it settles, so the next ask starts over instead of joining a wait that is ending.
                    this.forget(key, attempt);
                    attempt.controller.abort();
                }
                reject(new MachineWaitCancelled());
            };
            signal.addEventListener('abort', onAbort, { once: true });
            attempt.promise.then(
                (value) => {
                    signal.removeEventListener('abort', onAbort);
                    resolve(value);
                },
                (e: unknown) => {
                    signal.removeEventListener('abort', onAbort);
                    reject(e);
                }
            );
        });
    }

    private start(key: string, id: string): Attempt {
        const controller = new AbortController();
        const attempt: Attempt = {
            promise: this.attempt(id, controller.signal).finally(() => {
                this.forget(key, attempt);
            }),
            controller,
            waiters: 0,
            pinned: false
        };
        this.attempts.set(key, attempt);
        return attempt;
    }

    private forget(key: string, attempt: Attempt): void {
        if (this.attempts.get(key) === attempt) {
            this.attempts.delete(key);
        }
    }

    private async attempt(id: string, signal: AbortSignal): Promise<string> {
        const row = this.deps.rowFor(id) ?? this.deps.createRow(id);
        const release = this.deps.hold(row);
        try {
            await this.waitForOpen(row.id, signal);
            // A row that answered as a daemon it already knew moved onto that id while it came up.
            return this.deps.rowFor(id)?.id ?? row.id;
        } finally {
            release();
        }
    }

    private waitForOpen(endpointId: string, signal: AbortSignal): Promise<void> {
        const { deps } = this;
        return new Promise((resolve, reject) => {
            let settled = false;
            let off: () => void = () => undefined;
            const onAbort = (): void => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                off();
                reject(new MachineWaitCancelled());
            };
            const finish = (failure: string | null): void => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                off();
                signal.removeEventListener('abort', onAbort);
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
                    finish(state.failure ?? i18next.t('machines:link.silent'));
                }
            };
            const timer = setTimeout(() => finish(i18next.t('machines:link.silent')), deps.timeoutMs ?? ENSURE_TIMEOUT_MS);
            signal.addEventListener('abort', onAbort, { once: true });
            off = deps.subscribe(endpointId, check);
            // A link waiting out its backoff is tried now: a person just asked for this machine.
            if (deps.connection(endpointId).status === 'closed') {
                deps.reconnect(endpointId);
            }
            check();
        });
    }
}
