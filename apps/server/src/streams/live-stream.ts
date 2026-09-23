import type { LiveStreamFormat, LiveStreamFrame } from '@ruimte/contracts';

export interface LiveFrameSource {
    readonly format?: LiveStreamFormat;
    start(publish: (frame: LiveStreamFrame) => void): Promise<void>;
    stop(): Promise<void>;
    /* For a video source, whose frames after a gap only decode again from a key frame. */
    requestKeyFrame?(): void;
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

    requestKeyFrame(id: string): void {
        this.entries.get(id)?.source.requestKeyFrame?.();
    }

    format(id: string): LiveStreamFormat | null {
        const entry = this.entries.get(id);
        return entry ? (entry.source.format ?? 'jpeg') : null;
    }

    async subscribe(id: string, viewer: (frame: LiveStreamFrame) => void): Promise<() => void> {
        const entry = this.entries.get(id);
        if (!entry) {
            throw new Error('Live stream does not exist');
        }
        const running = entry.started;
        entry.viewers.add(viewer);
        try {
            await this.reconcile(entry);
        } catch (error) {
            entry.viewers.delete(viewer);
            throw error;
        }
        // A viewer joining a running video would otherwise wait for the encoder's next key frame.
        if (running) {
            entry.source.requestKeyFrame?.();
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
