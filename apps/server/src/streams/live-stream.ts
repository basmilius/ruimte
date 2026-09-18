import type { LiveStreamFrame } from '@ruimte/contracts';

export interface LiveFrameSource {
    readonly format?: 'jpeg' | 'hevc';
    start(publish: (frame: LiveStreamFrame) => void): Promise<void>;
    stop(): Promise<void>;
}

interface Entry {
    source: LiveFrameSource;
    viewers: Set<(frame: LiveStreamFrame) => void>;
    transition: Promise<void>;
    started: boolean;
}

export class LiveStreamHub {
    private readonly entries = new Map<string, Entry>();

    register(id: string, source: LiveFrameSource): () => void {
        if (this.entries.has(id)) {
            throw new Error(`Live stream ${id} already exists`);
        }
        const entry: Entry = { source, viewers: new Set(), transition: Promise.resolve(), started: false };
        this.entries.set(id, entry);
        return () => {
            if (this.entries.get(id) !== entry) {
                return;
            }
            this.entries.delete(id);
            entry.viewers.clear();
            void this.reconcile(entry).catch(() => undefined);
        };
    }

    has(id: string): boolean {
        return this.entries.has(id);
    }

    format(id: string): 'jpeg' | 'hevc' | null {
        const entry = this.entries.get(id);
        return entry ? (entry.source.format ?? 'jpeg') : null;
    }

    async subscribe(id: string, viewer: (frame: LiveStreamFrame) => void): Promise<() => void> {
        const entry = this.entries.get(id);
        if (!entry) {
            throw new Error('Live stream does not exist');
        }
        entry.viewers.add(viewer);
        try {
            await this.reconcile(entry);
        } catch (error) {
            entry.viewers.delete(viewer);
            throw error;
        }

        let subscribed = true;
        return () => {
            if (!subscribed) {
                return;
            }
            subscribed = false;
            entry.viewers.delete(viewer);
            void this.reconcile(entry).catch(() => undefined);
        };
    }

    private reconcile(entry: Entry): Promise<void> {
        const transition = entry.transition
            .catch(() => undefined)
            .then(async () => {
                if (entry.viewers.size > 0 && !entry.started) {
                    await entry.source.start((frame) => {
                        for (const sink of entry.viewers) {
                            sink(frame);
                        }
                    });
                    entry.started = true;
                } else if (entry.viewers.size === 0 && entry.started) {
                    entry.started = false;
                    await entry.source.stop();
                }
            });
        entry.transition = transition;
        return transition;
    }
}
