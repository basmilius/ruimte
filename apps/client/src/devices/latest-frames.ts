import type { LiveStreamFrame } from '@ruimte/contracts';
import type { Transport } from '@/transport-api/transport';
import { HandlerTable } from '@/transport/handler-table';

/* The live frames of the pages and devices a client follows, by key, with the last one of each kept. */
export class LatestFrames {
    private readonly handlers = new HandlerTable<LiveStreamFrame>();
    private readonly latest = new Map<string, LiveStreamFrame>();

    listen(key: string, handler: (frame: LiveStreamFrame) => void): () => void {
        const stop = this.handlers.listen(key, handler);
        // A view that mounts mid-stream draws the frame that is already in, rather than a blank canvas.
        const frame = this.latest.get(key);
        if (frame) {
            handler(frame);
        }
        return stop;
    }

    push(key: string, frame: LiveStreamFrame): void {
        this.latest.set(key, frame);
        this.handlers.fanOut(key, frame);
    }

    forget(key: string): void {
        this.latest.delete(key);
    }

    clear(): void {
        this.handlers.clear();
        this.latest.clear();
    }
}

/* What an open asks for to get its frames over the link, in binary pieces where the link carries them. */
export function eventStreamFields(stream: 'http' | 'events', transport: Pick<Transport, 'onLiveFrame'>): { stream?: 'events'; binary?: true } {
    return stream === 'events' ? { stream: 'events', ...(transport.onLiveFrame ? { binary: true } : {}) } : {};
}
