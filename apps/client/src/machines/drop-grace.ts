import type { ConnectionState } from '@/transport-api/transport';

/*
 * How long a dropped link may stay down before it counts as a machine that went away. Long enough
 * for the first try back on a busy machine, which a socket the machine closed on a full queue makes
 * within a second, and short enough that a machine that really left says so soon.
 */
export const DROP_GRACE_MS = 3_000;

interface DropGraceDeps {
    connection(endpointId: string): Pick<ConnectionState, 'status' | 'attempts'>;
    subscribe(endpointId: string, onChange: () => void): () => void;
    graceMs?: number;
    setTimer?(run: () => void, ms: number): ReturnType<typeof setTimeout>;
    clearTimer?(timer: ReturnType<typeof setTimeout>): void;
}

interface Watch {
    listeners: Set<() => void>;
    off: () => void;
    timer: ReturnType<typeof setTimeout> | null;
    overdue: boolean;
}

/* A link that was up and is on its way back; a link opening for the first time has nothing to come back to. */
function dropped(connection: Pick<ConnectionState, 'status' | 'attempts'>): boolean {
    return connection.status !== 'open' && connection.attempts > 0;
}

/*
 * Which dropped links have stayed down past the grace, per machine, for as long as something
 * watches. The clock is read only by a timer, so what a render asks is a plain flag.
 */
export class DropGrace {
    private readonly deps: DropGraceDeps;
    private readonly watches = new Map<string, Watch>();

    constructor(deps: DropGraceDeps) {
        this.deps = deps;
    }

    watch(endpointId: string, onChange: () => void): () => void {
        let entry = this.watches.get(endpointId);
        if (entry === undefined) {
            const created: Watch = { listeners: new Set(), off: () => undefined, timer: null, overdue: false };
            this.watches.set(endpointId, created);
            created.off = this.deps.subscribe(endpointId, () => this.check(endpointId, created));
            this.check(endpointId, created);
            entry = created;
        }
        const watch = entry;
        watch.listeners.add(onChange);
        return () => {
            watch.listeners.delete(onChange);
            if (watch.listeners.size > 0 || this.watches.get(endpointId) !== watch) {
                return;
            }
            this.watches.delete(endpointId);
            watch.off();
            this.stopTimer(watch);
        };
    }

    overdue(endpointId: string): boolean {
        return this.watches.get(endpointId)?.overdue ?? false;
    }

    private check(endpointId: string, watch: Watch): void {
        if (!dropped(this.deps.connection(endpointId))) {
            this.stopTimer(watch);
            if (watch.overdue) {
                watch.overdue = false;
                this.notify(watch);
            }
            return;
        }
        if (watch.timer !== null || watch.overdue) {
            return;
        }
        const setTimer = this.deps.setTimer ?? ((run, ms) => setTimeout(run, ms));
        watch.timer = setTimer(() => {
            watch.timer = null;
            watch.overdue = true;
            this.notify(watch);
        }, this.deps.graceMs ?? DROP_GRACE_MS);
    }

    private stopTimer(watch: Watch): void {
        if (watch.timer !== null) {
            (this.deps.clearTimer ?? clearTimeout)(watch.timer);
            watch.timer = null;
        }
    }

    private notify(watch: Watch): void {
        for (const listener of [...watch.listeners]) {
            listener();
        }
    }
}
