import type { ConnectPeerEntry, OutboxStore, OutboxWork } from '../../outbox/outbox.ts';
import { RemoteLinkError, RemoteRefusal, refusalWords, type RemoteConnections } from './remote-connections.ts';

// The wait after the first failed attempt, like the first poll of a PR-watch; each failure after it doubles the wait up to the cap.
export const RECONNECT_START_MS = 60_000;
export const RECONNECT_MAX_MS = 600_000;
// A link that cannot be made in this long is given up on.
export const RECONNECT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/* The project an entry for a machine is filed under: a reconnect belongs to no project, and no project has this id. */
export const PEERS_PROJECT = 'peers';

/* The lane of a machine in the outbox, which the entries owed to it share. Not an opener, though it shares the prefix. */
export function peerLane(machineId: string): string {
    return `peer:${machineId}`;
}

interface ConnectPeerDeps {
    outbox: { ofKind(kind: 'connect-peer'): ConnectPeerEntry[] };
    /* The targets of the work owed to a machine: a task given to it, its result, a stop. */
    owedTargets(machineId: string): string[];
    enqueue(projectId: string, target: string, work: OutboxWork, notBefore?: number): Promise<void>;
    /* Looks again at whatever waited on this target. */
    wake(target: string): void;
    /* Fails the work still owed to a machine that stayed out of reach for the whole window, or that refused this one (`refusal` says why). */
    giveUp(machineId: string, refusal?: string): Promise<void>;
    connections: Pick<RemoteConnections, 'connect' | 'isOpen' | 'knows' | 'idle' | 'waiting'>;
    now(): number;
    random(): number;
}

/*
 * The reconnect of the link to another machine, as an outbox entry. It is owed only while work for that
 * machine waits (a task given to it, its result, a stop), and each failure doubles the wait from a
 * minute to ten, so a machine that sleeps is not woken by a daemon that keeps knocking. It ends when
 * nothing is owed to the machine any more, when the machine is unlinked, when it refuses this one, or
 * after 7 days in which no link opened.
 */
export class ConnectPeer {
    private readonly deps: ConnectPeerDeps;
    // Machines whose attempt is running, and those whose link was lost meanwhile and so need a new entry once it ends.
    private readonly running = new Set<string>();
    // When the machine stopped answering while work was owed, which the 7 days count from; a link that opens starts the count over.
    private readonly firstOwed = new Map<string, number>();
    private readonly lostMeanwhile = new Set<string>();

    constructor(deps: ConnectPeerDeps) {
        this.deps = deps;
    }

    /* Owes a reconnect to this machine, if work waits on it, unless the link is open or one is owed already. */
    async owe(machineId: string): Promise<void> {
        if (this.owedTo(machineId) === 0 || !this.deps.connections.knows(machineId)) {
            this.firstOwed.delete(machineId);
            return;
        }
        if (this.deps.connections.isOpen(machineId)) {
            return;
        }
        if (this.running.has(machineId)) {
            this.lostMeanwhile.add(machineId);
            return;
        }
        if (this.entriesOf(machineId).length > 0) {
            return;
        }
        await this.write(machineId, this.sinceOf(machineId), RECONNECT_START_MS, this.deps.now());
    }

    /* Ends the reconnects owed to a machine, as unlinking it does. */
    async lapse(machineId: string, remove: (id: string) => Promise<void>): Promise<void> {
        this.firstOwed.delete(machineId);
        for (const entry of this.entriesOf(machineId)) {
            await remove(entry.id);
        }
    }

    /* Ends every reconnect, as leaving the account does. */
    async lapseAll(remove: (id: string) => Promise<void>): Promise<void> {
        this.firstOwed.clear();
        for (const entry of this.deps.outbox.ofKind('connect-peer')) {
            await remove(entry.id);
        }
    }

    readonly handler = async (entry: ConnectPeerEntry): Promise<void> => {
        const { machineId, since, interval } = entry.payload;
        const { connections } = this.deps;
        if (!connections.knows(machineId) || this.owedTo(machineId) === 0) {
            this.firstOwed.delete(machineId);
            connections.idle(machineId);
            return;
        }
        if (this.deps.now() - since >= RECONNECT_LIFETIME_MS) {
            // What was owed fails and wakes its parents, so work that comes after starts a window of its own.
            this.firstOwed.delete(machineId);
            await this.deps.giveUp(machineId);
            connections.idle(machineId);
            return;
        }
        this.firstOwed.set(machineId, since);
        this.running.add(machineId);
        let opened = false;
        try {
            await connections.connect(machineId);
            opened = true;
            this.firstOwed.delete(machineId);
            this.wakeOwed(machineId);
        } catch (e) {
            // A machine that will not have this one says so again however often it is asked, so what waits on it fails now.
            if (e instanceof RemoteRefusal) {
                this.firstOwed.delete(machineId);
                await this.deps.giveUp(machineId, refusalWords(e.refusal));
                connections.idle(machineId);
            } else if (e instanceof RemoteLinkError && e.code === 'closed') {
                connections.idle(machineId);
            } else {
                await this.retry(entry, machineId, since, interval);
            }
        } finally {
            this.running.delete(machineId);
        }
        // This entry is still in the outbox until the worker removes it, so `owe` would take it for the reconnect that is owed.
        if (this.lostMeanwhile.delete(machineId) && !connections.isOpen(machineId) && this.entriesOf(machineId).every((other) => other.id === entry.id)) {
            await this.write(machineId, opened ? this.deps.now() : this.sinceOf(machineId), RECONNECT_START_MS, this.deps.now());
        }
    };

    private sinceOf(machineId: string): number {
        const kept = this.firstOwed.get(machineId) ?? this.entriesOf(machineId)[0]?.payload.since ?? this.deps.now();
        this.firstOwed.set(machineId, kept);
        return kept;
    }

    private async retry(entry: ConnectPeerEntry, machineId: string, since: number, interval: number): Promise<void> {
        if (this.owedTo(machineId) === 0) {
            this.deps.connections.idle(machineId);
            return;
        }
        const now = this.deps.now();
        const at = now + Math.round(interval * (0.9 + 0.2 * this.deps.random()));
        await this.write(machineId, since, Math.min(interval * 2, RECONNECT_MAX_MS), at, entry.projectId);
        this.deps.connections.waiting(machineId, at);
    }

    private write(machineId: string, since: number, interval: number, notBefore: number, projectId = PEERS_PROJECT): Promise<void> {
        return this.deps.enqueue(projectId, peerLane(machineId), { kind: 'connect-peer', payload: { machineId, since, interval } }, notBefore);
    }

    private entriesOf(machineId: string): ConnectPeerEntry[] {
        return this.deps.outbox.ofKind('connect-peer').filter((entry) => entry.payload.machineId === machineId);
    }

    private owedTo(machineId: string): number {
        return this.deps.owedTargets(machineId).length;
    }

    private wakeOwed(machineId: string): void {
        for (const target of new Set(this.deps.owedTargets(machineId))) {
            this.deps.wake(target);
        }
    }
}

/*
 * Every reconnect still owed when the daemon starts was waiting out a delay an earlier run set, and the
 * machine may well be back: each is due now. Call after the outbox loaded and before its worker starts.
 */
export async function restartConnectPeers(outbox: Pick<OutboxStore, 'ofKind' | 'update'>, now: number): Promise<void> {
    for (const entry of outbox.ofKind('connect-peer')) {
        await outbox.update({ ...entry, notBefore: now, attempts: 0 });
    }
}
