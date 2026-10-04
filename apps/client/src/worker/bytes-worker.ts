import { BYTES_STREAM_PATH, answerRange, type PieceQuestion } from '../transport/bytes-stream';
import type { BytesPiece } from '../transport/piece';

/*
 * The service worker behind a video over a direct connection. A media element can only ask HTTP for
 * ranges, and only a page holds the channel to the machine, so this answers the element's ranges with
 * pieces it asks the page for. It answers its own path and lets every other request pass.
 */
const worker = self as unknown as ServiceWorkerGlobalScope;

type PieceAnswer = { ok: true; result: BytesPiece } | { ok: false; message: string };

async function askPage(clientId: string, question: PieceQuestion): Promise<BytesPiece> {
    const client = await worker.clients.get(clientId);
    if (!client) {
        throw new Error('The page that asked is gone');
    }
    const channel = new MessageChannel();
    const answered = new Promise<BytesPiece>((resolve, reject) => {
        channel.port1.onmessage = (event: MessageEvent<PieceAnswer>) => {
            channel.port1.close();
            if (event.data.ok) {
                resolve(event.data.result);
            } else {
                reject(new Error(event.data.message));
            }
        };
    });
    client.postMessage(question, [channel.port2]);
    return answered;
}

type RoutedInstall = ExtendableEvent & {
    addRoutes?: (rules: { condition: object; source: 'network' | 'fetch-event' }[]) => Promise<void>;
};

worker.addEventListener('install', (event: RoutedInstall) => {
    void worker.skipWaiting();
    // Every other request then skips the worker, which otherwise has to wake for each one; where the routing API is missing it only costs that.
    const routed = event.addRoutes?.([{ condition: { not: { urlPattern: { pathname: BYTES_STREAM_PATH } } }, source: 'network' }]);
    if (routed) {
        event.waitUntil(routed.catch(() => undefined));
    }
});

worker.addEventListener('activate', (event) => {
    event.waitUntil(worker.clients.claim());
});

worker.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.origin !== worker.location.origin || url.pathname !== BYTES_STREAM_PATH) {
        return;
    }
    const { request, clientId } = event;
    event.respondWith(
        answerRange({ url: request.url, method: request.method, mode: request.mode, range: request.headers.get('range') }, (question) =>
            askPage(clientId, question)
        )
    );
});
