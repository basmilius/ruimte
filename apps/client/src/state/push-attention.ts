import type { PushAttentionEntry } from '@ruimte/contracts';
import { readOnEveryOpen, type Transport, fireAndForget } from '@/transport-api/transport';

const changeListeners = new Set<() => void>();

export class PushAttentionSync {
    private readonly entries = new Map<string, PushAttentionEntry>();
    private visible: ReadonlySet<string> = new Set();
    private readonly pending = new Set<string>();
    private readonly off: (() => void)[];
    private generation = 0;
    // What the machine holds from before its marks start is left alone; null until it says.
    private marksFrom: number | null = null;
    private disposed = false;

    private readonly transport: Transport;

    constructor(transport: Transport) {
        this.transport = transport;
        this.off = [
            transport.on('push.attention', (entry) => this.receive(entry)),
            readOnEveryOpen(
                transport,
                () => void this.refresh(),
                () => {
                    this.generation++;
                    this.entries.clear();
                }
            )
        ];
    }

    setVisible(nodes: ReadonlySet<string>): void {
        this.visible = nodes;
        for (const id of nodes) {
            this.markSeen(id);
        }
    }

    markSeen(nodeId: string): void {
        const entry = this.entries.get(nodeId);
        if (this.disposed || !entry || entry.readThrough >= entry.issuedAt || this.transport.status !== 'open') {
            return;
        }
        const key = JSON.stringify([nodeId, entry.issuedAt]);
        if (this.pending.has(key)) {
            return;
        }
        this.pending.add(key);
        void fireAndForget(
            'push.read',
            this.transport.request('push.read', { nodeId, issuedAt: entry.issuedAt }).then(() => {
                this.receive({ ...entry, readThrough: entry.issuedAt });
            })
        ).finally(() => this.pending.delete(key));
    }

    /* The nodes the machine holds something unread for. A turn that ended or a task that failed, whether or not a client was there. */
    unread(): string[] {
        const from = this.marksFrom;
        if (from === null) {
            return [];
        }
        return [...this.entries.values()].filter((entry) => entry.readThrough < entry.issuedAt && entry.issuedAt >= from).map((entry) => entry.nodeId);
    }

    dispose(): void {
        this.disposed = true;
        this.generation++;
        this.off.forEach((off) => off());
    }

    private receive(entry: PushAttentionEntry): void {
        const previous = this.entries.get(entry.nodeId);
        const merged = {
            ...entry,
            issuedAt: Math.max(entry.issuedAt, previous?.issuedAt ?? 0),
            readThrough: Math.max(entry.readThrough, previous?.readThrough ?? 0)
        };
        this.entries.set(entry.nodeId, merged);
        for (const listener of changeListeners) {
            listener();
        }
        if (this.visible.has(entry.nodeId)) {
            this.markSeen(entry.nodeId);
        }
    }

    private async refresh(): Promise<void> {
        const generation = this.generation;
        try {
            const { entries, marksFrom } = await this.transport.request('push.attention', {});
            if (generation !== this.generation) {
                return;
            }
            this.marksFrom = marksFrom ?? null;
            for (const entry of entries) {
                this.receive(entry);
            }
        } catch {
            // A failed ask leaves the marks as they were; the next fresh link asks again.
        }
    }
}

const machines = new Map<string, PushAttentionSync>();

export function watchPushAttention(endpointId: string, transport: Transport): () => void {
    const sync = new PushAttentionSync(transport);
    machines.set(endpointId, sync);
    return () => {
        sync.dispose();
        if (machines.get(endpointId) === sync) {
            machines.delete(endpointId);
        }
    };
}

/* The nodes a person can see, by the machine each runs on: the notifications of a machine are about its own nodes only. */
export function seePushNotifications(visibleOn: ReadonlyMap<string, ReadonlySet<string>>): void {
    for (const [id, sync] of machines) {
        sync.setVisible(visibleOn.get(id) ?? new Set());
    }
}

/* What a machine still holds unread, which the marks start from after a client was away. */
export function unreadOnMachine(endpointId: string): string[] {
    return machines.get(endpointId)?.unread() ?? [];
}

export function subscribePushAttention(listener: () => void): () => void {
    changeListeners.add(listener);
    return () => {
        changeListeners.delete(listener);
    };
}
