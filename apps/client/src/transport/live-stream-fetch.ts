import { messageOf } from '@adecore/ui';
import { LiveStreamDecoder, type LiveStreamFrame } from '@ruimte/contracts';
import { credentialFor } from '@/transport-api/credentials';
import { wait } from '@/transport/live-stream';

const RETRY_MS = 1_000;

interface FollowOptions<F> {
    /* Null for a content type this surface cannot paint. */
    formatOf(contentType: string): F | null;
    onFrame(frame: LiveStreamFrame, format: F): void;
    onError(message: string): void;
    words: { notReady(): string; status(status: number): string; unknownFormat(): string; stopped(): string };
}

/* Reads a machine's live stream over HTTP until the signal aborts, and asks again a second after it broke off. */
export async function followLiveStream<F>(
    endpoint: { id: string; httpBaseUrl: string },
    streamId: string,
    signal: AbortSignal,
    { formatOf, onFrame, onError, words }: FollowOptions<F>
): Promise<void> {
    while (!signal.aborted) {
        try {
            const credential = credentialFor(endpoint);
            const headers = credential ? { Authorization: `Bearer ${credential}` } : undefined;
            const response = await fetch(`${endpoint.httpBaseUrl}/live-stream/${encodeURIComponent(streamId)}`, { headers, signal });
            if (!response.ok || !response.body) {
                throw new Error(response.status === 404 ? words.notReady() : words.status(response.status));
            }
            const format = formatOf(response.headers.get('content-type') ?? '');
            if (format === null) {
                throw new Error(words.unknownFormat());
            }
            const decoder = new LiveStreamDecoder();
            const reader = response.body.getReader();
            while (!signal.aborted) {
                const next = await reader.read();
                if (next.done) {
                    break;
                }
                for (const frame of decoder.push(next.value)) {
                    onFrame(frame, format);
                }
            }
        } catch (error) {
            if (!signal.aborted) {
                onError(messageOf(error, words.stopped()));
            }
        }
        await wait(RETRY_MS, signal);
    }
}
