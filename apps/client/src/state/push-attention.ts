import type { PushAttentionEntry } from '@ruimte/contracts';
import type { Transport } from '@/transport/transport';

const changeListeners = new Set<() => void>();

export class PushAttentionSync {
    private readonly entries = new Map<string, PushAttentionEntry>();
    private visible: ReadonlySet<string> = new Set();
    private readonly pending = new Set<string>();
    private readonly off: (() => void)[];
    private generation = 0;
    // What the machine holds from before it said when marks start is left alone; null until it says, and for a machine that never does.
    private marksFrom: number | null = null;
    private disposed = false;

    private readonly transport: Transport;

    constructor(transport: Transport) {
        this.transport = transport;
        this.off = [
            transport.on('push.attention', (entry) => this.receive(entry)),
            transport.subscribeStatus((status) => {
                this.generation++;
                this.entries.clear();
                if (status === 'open') {
                    void this.refresh();
                }
            })
        ];
        if (transport.status === 'open') {
            void this.refresh();
        }
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
        void this.transport
            .request('push.read', { nodeId, issuedAt: entry.issuedAt })
            .then(() => {
                this.receive({ ...entry, readThrough: entry.issuedAt });
            })
            .catch(() => undefined)
            .finally(() => this.pending.delete(key));
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
            // Older daemons have no shared notification state yet.
        }
    }
}

const machines = new Map<string, PushAttentionSync>();

export const watchPushAttention = (endpointId: string, transport: Transport): (() => void) => {
    const sync = new PushAttentionSync(transport);
    machines.set(endpointId, sync);
    return () => {
        sync.dispose();
        if (machines.get(endpointId) === sync) {
            machines.delete(endpointId);
        }
    };
};

export const seePushNotifications = (endpointId: string, nodes: ReadonlySet<string>): void => {
    for (const [id, sync] of machines) {
        sync.setVisible(id === endpointId ? nodes : new Set());
    }
};

/* What a machine still holds unread, which the marks start from after a client was away. */
export const unreadOnMachine = (endpointId: string): string[] => machines.get(endpointId)?.unread() ?? [];

export const subscribePushAttention = (listener: () => void): (() => void) => {
    changeListeners.add(listener);
    return () => {
        changeListeners.delete(listener);
    };
};

export const clearPushNotification = (endpointId: string, nodeId: string): void => machines.get(endpointId)?.markSeen(nodeId);
