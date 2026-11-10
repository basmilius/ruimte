import type { Clock } from '@adecore/agents/coordination';
import { SnoozeListSchema, type Snooze } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import { JsonFileStore } from '../json-file-store.ts';
import { wakefulClock } from '../timers.ts';
import type { SessionSink } from '../wire.ts';

/* Woke: the snooze ran out by itself, so a node still waiting is a new wait. Cleared: a person ended it early, and knows. */
export interface SnoozeChange {
    kind: 'snoozed' | 'woke' | 'cleared';
    nodeId: string;
}

interface SnoozeStoreOptions {
    path?: string;
    clock?: Clock;
}

function keyOf(projectId: string, nodeId: string): string {
    return JSON.stringify([projectId, nodeId]);
}

/*
 * The snoozes of this machine, one per node, shared by every client and the push alerts. They live
 * under `$RUIMTE_HOME` and never in a project file: putting a node aside is one person's, not the team's.
 */
export class SnoozeStore {
    private readonly entries = new Map<string, Snooze>();
    /* Snoozed nodes seen waiting since the snooze was set; only those end it by no longer waiting. */
    private readonly waiting = new Set<string>();
    private readonly sinks = new ClientSinks();
    private readonly listeners = new Set<(change: SnoozeChange) => void>();
    private readonly file: JsonFileStore<{ snoozes: Snooze[] }>;
    private readonly clock: Clock;
    private timer: unknown = null;

    constructor(options: SnoozeStoreOptions = {}) {
        this.file = new JsonFileStore(options.path, SnoozeListSchema, 'snoozes start empty');
        this.clock = wakefulClock(options.clock);
        const saved = this.file.read()?.snoozes ?? [];
        const now = this.clock.now();
        // What ran out while the daemon was down wakes nobody: no status is known yet to say the node still waits.
        for (const snooze of saved.filter((entry) => entry.until > now)) {
            this.entries.set(keyOf(snooze.projectId, snooze.nodeId), snooze);
        }
        if (this.entries.size !== saved.length) {
            this.save();
        }
        this.arm();
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    observe(listener: (change: SnoozeChange) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    list(): Snooze[] {
        return [...this.entries.values()];
    }

    isSnoozed(nodeId: string): boolean {
        return this.until(nodeId) !== null;
    }

    /* When the snooze on a node ends, in epoch milliseconds; null when it has none. */
    until(nodeId: string): number | null {
        const now = this.clock.now();
        return this.list().find((entry) => entry.nodeId === nodeId && entry.until > now)?.until ?? null;
    }

    set(projectId: string, nodeId: string, until: number): void {
        if (until <= this.clock.now()) {
            this.clear(nodeId);
            return;
        }
        const key = keyOf(projectId, nodeId);
        if (this.entries.get(key)?.until === until) {
            return;
        }
        const fresh = !this.isSnoozed(nodeId);
        this.remove((entry) => entry.nodeId === nodeId && entry.projectId !== projectId);
        this.entries.set(key, { projectId, nodeId, until });
        this.changed();
        if (fresh) {
            this.waiting.delete(nodeId);
            this.tell({ kind: 'snoozed', nodeId });
        }
    }

    /* A person ending a snooze before its time. */
    clear(nodeId: string): void {
        if (this.remove((entry) => entry.nodeId === nodeId).length > 0) {
            this.changed();
            this.tell({ kind: 'cleared', nodeId });
        }
    }

    /*
     * Whether a snoozed node needs you right now. One seen waiting that stops was answered, so its
     * snooze ends without waking anything. One never seen waiting has said nothing yet: a terminal
     * reads as running after a restart until its agent reports again.
     */
    noteStatus(nodeId: string, needsYou: boolean): void {
        if (!this.isSnoozed(nodeId)) {
            this.waiting.delete(nodeId);
            return;
        }
        if (needsYou) {
            this.waiting.add(nodeId);
            return;
        }
        if (this.waiting.delete(nodeId) && this.remove((entry) => entry.nodeId === nodeId).length > 0) {
            this.changed();
        }
    }

    /* For `ProjectIndex.onPlaces`: a node that left its project takes its snooze along. */
    places(projectId: string, ids: ReadonlySet<string>): void {
        if (this.remove((entry) => entry.projectId === projectId && !ids.has(entry.nodeId)).length > 0) {
            this.changed();
        }
    }

    stop(): void {
        if (this.timer !== null) {
            this.clock.clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private remove(match: (entry: Snooze) => boolean): Snooze[] {
        const removed: Snooze[] = [];
        for (const [key, entry] of this.entries) {
            if (match(entry)) {
                this.entries.delete(key);
                this.waiting.delete(entry.nodeId);
                removed.push(entry);
            }
        }
        return removed;
    }

    private expire(): void {
        const now = this.clock.now();
        const ended = this.remove((entry) => entry.until <= now);
        if (ended.length === 0) {
            return;
        }
        this.changed();
        for (const entry of ended) {
            this.tell({ kind: 'woke', nodeId: entry.nodeId });
        }
    }

    private arm(): void {
        this.stop();
        const next = Math.min(...this.list().map((entry) => entry.until));
        if (!Number.isFinite(next)) {
            return;
        }
        this.timer = this.clock.setTimeout(
            () => {
                this.timer = null;
                this.expire();
                this.arm();
            },
            Math.max(0, next - this.clock.now())
        );
    }

    private changed(): void {
        this.save();
        this.arm();
        this.sinks.emit({ event: 'snooze.changed', payload: { snoozes: this.list() } });
    }

    private tell(change: SnoozeChange): void {
        for (const listener of this.listeners) {
            listener(change);
        }
    }

    private save(): void {
        this.file.write({ snoozes: this.list() });
    }
}
