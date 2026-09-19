import type { LiveStreamFrame } from '@ruimte/contracts';
import type { ClientSinks } from '../client-sinks.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import type { LiveStreamHub } from './live-stream.ts';

/*
 * A subscription that may be cancelled before `subscribe` came back with what releases it; the flag
 * is what a frame arriving in between reads.
 */
interface FrameSubscription {
    cancelled: boolean;
    release: (() => void) | null;
}

/* Two ids as one key, for a stream a pair of ids names. */
export const streamKeyOf = (...parts: string[]): string => JSON.stringify(parts);

/*
 * Who hears the frames of a live stream over the socket, per stream and per client. A page or a
 * device draws itself from a direct channel wherever it can; this is the way that is always there.
 */
export class FrameFanout {
    private readonly streams: LiveStreamHub;
    private readonly sinks: ClientSinks;
    private readonly byStream = new Map<string, Map<string, FrameSubscription>>();

    constructor(streams: LiveStreamHub, sinks: ClientSinks) {
        this.streams = streams;
        this.sinks = sinks;
    }

    /*
     * Sends this client the frames of one stream, replacing whatever it heard before. A subscribe
     * that fails leaves nothing behind and throws on: the caller says what that failure is called.
     */
    async start(streamKey: string, streamId: string, clientId: string, toEvent: (frame: LiveStreamFrame) => SessionEvent): Promise<void> {
        this.stop(streamKey, clientId);
        const subscription: FrameSubscription = { cancelled: false, release: null };
        const byClient = this.byStream.get(streamKey) ?? new Map<string, FrameSubscription>();
        byClient.set(clientId, subscription);
        this.byStream.set(streamKey, byClient);
        try {
            const release = await this.streams.subscribe(streamId, (frame) => {
                if (!subscription.cancelled) {
                    this.sinks.to(clientId, toEvent(frame));
                }
            });
            if (subscription.cancelled) {
                release();
            } else {
                subscription.release = release;
            }
        } catch (error) {
            this.forget(streamKey, clientId);
            throw error;
        }
    }

    stop(streamKey: string, clientId: string): void {
        const subscription = this.byStream.get(streamKey)?.get(clientId);
        if (!subscription) {
            return;
        }
        subscription.cancelled = true;
        subscription.release?.();
        this.forget(streamKey, clientId);
    }

    /* Takes every client off one stream, for a session that is going. */
    stopAll(streamKey: string): void {
        for (const clientId of [...(this.byStream.get(streamKey)?.keys() ?? [])]) {
            this.stop(streamKey, clientId);
        }
    }

    hasListeners(streamKey: string): boolean {
        return (this.byStream.get(streamKey)?.size ?? 0) > 0;
    }

    private forget(streamKey: string, clientId: string): void {
        const byClient = this.byStream.get(streamKey);
        if (!byClient) {
            return;
        }
        byClient.delete(clientId);
        if (byClient.size === 0) {
            this.byStream.delete(streamKey);
        }
    }
}
