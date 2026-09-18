import { LIVE_STREAM_CONTENT_TYPE, LIVE_STREAM_MAGIC, encodeLiveStreamFrame } from '@ruimte/contracts';
import type { AuthStore } from '../auth/auth-store.ts';
import { decideAccess, originAllowed, type AccessOptions } from '../auth/access.ts';
import type { LiveStreamHub } from './live-stream.ts';

export const LIVE_STREAM_PATH = '/live-stream';

const corsHeaders = (origin: string | null): Record<string, string> => (origin === null ? {} : { 'access-control-allow-origin': origin, vary: 'origin' });

export const handleLiveStreamRequest = async (
    request: Request,
    url: URL,
    remoteAddress: string,
    auth: AuthStore,
    options: AccessOptions,
    hub: LiveStreamHub,
    streamingAllowed: () => boolean = () => true
): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers = corsHeaders(origin);
    if (request.method === 'OPTIONS') {
        if (!originAllowed(origin, request.headers.get('host'), options.allowedOrigins)) {
            return new Response('Origin not allowed', { status: 403 });
        }
        return new Response(null, {
            status: 204,
            headers: { ...headers, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'authorization' }
        });
    }
    if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405, headers });
    }
    const decision = await decideAccess(request, remoteAddress, auth, options);
    if (!decision.ok) {
        return new Response(decision.reason, { status: decision.status, headers });
    }
    if (!streamingAllowed()) {
        return new Response('Browser and device streaming is disabled on this machine', { status: 403, headers });
    }
    const encodedId = url.pathname.slice(LIVE_STREAM_PATH.length + 1);
    if (encodedId === '' || encodedId.includes('/')) {
        return new Response('Not found', { status: 404, headers });
    }
    let sourceId: string;
    try {
        sourceId = decodeURIComponent(encodedId);
    } catch {
        return new Response('Not found', { status: 404, headers });
    }
    if (!hub.has(sourceId)) {
        return new Response('Live stream not found', { status: 404, headers });
    }

    let unsubscribe: (() => void) | null = null;
    let pending: Uint8Array | null = null;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            controller.enqueue(LIVE_STREAM_MAGIC.slice());
            try {
                unsubscribe = await hub.subscribe(sourceId, (frame) => {
                    const bytes = encodeLiveStreamFrame(frame);
                    if ((controller.desiredSize ?? 0) > 0) {
                        controller.enqueue(bytes);
                    } else {
                        pending = bytes;
                    }
                });
                if (cancelled) {
                    unsubscribe();
                    unsubscribe = null;
                }
            } catch (error) {
                controller.error(error);
            }
        },
        pull(controller) {
            if (pending) {
                controller.enqueue(pending);
                pending = null;
            }
        },
        cancel() {
            cancelled = true;
            pending = null;
            unsubscribe?.();
            unsubscribe = null;
        }
    });
    request.signal.addEventListener(
        'abort',
        () => {
            cancelled = true;
            pending = null;
            unsubscribe?.();
            unsubscribe = null;
        },
        { once: true }
    );
    return new Response(stream, {
        headers: {
            ...headers,
            'content-type': LIVE_STREAM_CONTENT_TYPE,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff'
        }
    });
};
