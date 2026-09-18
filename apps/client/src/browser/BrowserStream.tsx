import { useEffect, useRef, useState } from 'react';
import { LiveStreamDecoder, LIVE_STREAM_CONTENT_TYPE, type BrowserInput, type LiveStreamFrame } from '@ruimte/contracts';
import { CircleAlert, MonitorUp } from 'lucide-react';
import { browserClientFor } from '@/transport/connections';
import { credentialFor } from '@/endpoint/credentials';
import { useEndpointId } from '@/state/keys';
import { useEndpoints } from '@/state/endpoints';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { useBrowserRow } from './registry';

const RETRY_MS = 1_000;

const modifiersOf = (event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number =>
    (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);

const buttonOf = (button: number): 'left' | 'middle' | 'right' => (button === 1 ? 'middle' : button === 2 ? 'right' : 'left');

const buttonsOf = (buttons: number): number => (buttons & 1 ? 1 : 0) | (buttons & 2 ? 4 : 0) | (buttons & 4 ? 2 : 0);

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
        const timer = window.setTimeout(resolve, ms);
        signal.addEventListener(
            'abort',
            () => {
                window.clearTimeout(timer);
                resolve();
            },
            { once: true }
        );
    });

export function BrowserStream({ id, initialUrl: savedUrl, className }: { id: string; initialUrl: string; className?: string }) {
    const endpointId = useEndpointId();
    const endpoint = useEndpoints((state) => state.endpoints.find((entry) => entry.id === endpointId) ?? null);
    const row = useBrowserRow(id, (state) => state);
    const host = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const frameSize = useRef({ width: 1, height: 1 });
    const moveFrame = useRef<number | null>(null);
    const pendingMove = useRef<BrowserInput | null>(null);
    const initialUrl = useRef(row?.url || savedUrl);
    const [ready, setReady] = useState(false);
    const [imageReady, setImageReady] = useState(false);
    const [streamError, setStreamError] = useState<string | null>(null);
    const direct = endpoint?.direct === true;

    useEffect(
        () => () => {
            if (moveFrame.current !== null) {
                cancelAnimationFrame(moveFrame.current);
            }
        },
        []
    );

    useEffect(() => {
        if (direct) {
            return;
        }
        const client = browserClientFor(endpointId);
        const element = host.current;
        if (!client || !element) {
            return;
        }
        const rect = element.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width || 800));
        const height = Math.max(1, Math.round(rect.height || 600));
        let mounted = true;
        void client.open(id, initialUrl.current, width, height).then(
            () => mounted && setReady(true),
            (error) => mounted && setStreamError(error instanceof Error ? error.message : 'The browser could not start')
        );
        const observer = new ResizeObserver(([entry]) => {
            if (!entry) {
                return;
            }
            const nextWidth = Math.max(1, Math.round(entry.contentRect.width));
            const nextHeight = Math.max(1, Math.round(entry.contentRect.height));
            void client.resize(id, nextWidth, nextHeight);
        });
        observer.observe(element);
        return () => {
            mounted = false;
            observer.disconnect();
            void client.detach(id);
        };
    }, [direct, endpointId, id]);

    useEffect(() => {
        if (!ready || direct || !endpoint) {
            return;
        }
        const controller = new AbortController();
        let pending: LiveStreamFrame | null = null;
        let decoding = false;

        const paint = async (): Promise<void> => {
            if (decoding) {
                return;
            }
            decoding = true;
            try {
                while (pending && !controller.signal.aborted) {
                    const frame = pending;
                    pending = null;
                    const bitmap = await createImageBitmap(new Blob([frame.data.slice().buffer], { type: 'image/jpeg' }));
                    const surface = canvas.current;
                    if (surface) {
                        surface.width = frame.width;
                        surface.height = frame.height;
                        frameSize.current = { width: frame.width, height: frame.height };
                        surface.getContext('2d', { alpha: false })?.drawImage(bitmap, 0, 0, frame.width, frame.height);
                        setImageReady(true);
                        setStreamError(null);
                    }
                    bitmap.close();
                }
            } finally {
                decoding = false;
            }
        };

        const consume = async (): Promise<void> => {
            while (!controller.signal.aborted) {
                try {
                    const credential = credentialFor(endpoint);
                    const headers = credential ? { Authorization: `Bearer ${credential}` } : undefined;
                    const response = await fetch(`${endpoint.httpBaseUrl}/live-stream/${encodeURIComponent(`browser:${id}`)}`, {
                        headers,
                        signal: controller.signal
                    });
                    if (!response.ok || !response.body) {
                        throw new Error(response.status === 404 ? 'The browser stream is not ready yet' : `The browser stream returned ${response.status}`);
                    }
                    if (!response.headers.get('content-type')?.startsWith(LIVE_STREAM_CONTENT_TYPE.split(';')[0]!)) {
                        throw new Error('The machine returned an unknown stream format');
                    }
                    const decoder = new LiveStreamDecoder();
                    const reader = response.body.getReader();
                    while (!controller.signal.aborted) {
                        const next = await reader.read();
                        if (next.done) {
                            break;
                        }
                        for (const frame of decoder.push(next.value)) {
                            pending = frame;
                        }
                        void paint().catch((error) => setStreamError(error instanceof Error ? error.message : 'A frame could not be drawn'));
                    }
                } catch (error) {
                    if (!controller.signal.aborted) {
                        setStreamError(error instanceof Error ? error.message : 'The browser stream stopped');
                    }
                }
                await wait(RETRY_MS, controller.signal);
            }
        };
        void consume();
        return () => controller.abort();
    }, [direct, endpoint, id, ready]);

    const send = (input: BrowserInput): void => browserClientFor(endpointId)?.input(id, input);
    const position = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
        const rect = canvas.current!.getBoundingClientRect();
        return {
            x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * frameSize.current.width,
            y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * frameSize.current.height
        };
    };

    if (direct) {
        return (
            <div ref={host} className={`flex h-full items-center justify-center bg-surface px-6 text-center ${className ?? ''}`}>
                <EmptyState icon={<Icon icon={MonitorUp} size={24} />}>Live pages over a direct connection are not available yet.</EmptyState>
            </div>
        );
    }

    const visibleError = row?.streamError ?? streamError;
    return (
        <div ref={host} className={`relative h-full overflow-hidden bg-surface-sunken ${className ?? ''}`}>
            <canvas
                ref={canvas}
                className="h-full w-full touch-none outline-none"
                aria-label="Remote web page"
                tabIndex={0}
                onContextMenu={(event) => event.preventDefault()}
                onPointerDown={(event) => {
                    event.currentTarget.focus();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    send({
                        kind: 'pointer',
                        phase: 'down',
                        ...position(event),
                        button: buttonOf(event.button),
                        buttons: buttonsOf(event.buttons),
                        modifiers: modifiersOf(event)
                    });
                }}
                onPointerMove={(event) => {
                    pendingMove.current = {
                        kind: 'pointer',
                        phase: 'move',
                        ...position(event),
                        buttons: buttonsOf(event.buttons),
                        modifiers: modifiersOf(event)
                    };
                    if (moveFrame.current === null) {
                        moveFrame.current = requestAnimationFrame(() => {
                            moveFrame.current = null;
                            if (pendingMove.current) {
                                send(pendingMove.current);
                                pendingMove.current = null;
                            }
                        });
                    }
                }}
                onPointerUp={(event) => {
                    send({
                        kind: 'pointer',
                        phase: 'up',
                        ...position(event),
                        button: buttonOf(event.button),
                        buttons: buttonsOf(event.buttons),
                        modifiers: modifiersOf(event)
                    });
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={(event) => {
                    send({
                        kind: 'pointer',
                        phase: 'up',
                        ...position(event),
                        button: buttonOf(event.button),
                        buttons: 0,
                        modifiers: modifiersOf(event)
                    });
                }}
                onWheel={(event) => {
                    event.preventDefault();
                    send({ kind: 'wheel', ...position(event), deltaX: event.deltaX, deltaY: event.deltaY, modifiers: modifiersOf(event) });
                }}
                onKeyDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    send({
                        kind: 'key',
                        phase: 'down',
                        key: event.key,
                        code: event.code,
                        ...(event.key.length === 1 ? { text: event.key } : {}),
                        modifiers: modifiersOf(event)
                    });
                }}
                onKeyUp={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    send({ kind: 'key', phase: 'up', key: event.key, code: event.code, modifiers: modifiersOf(event) });
                }}
                onPaste={(event) => {
                    event.preventDefault();
                    send({ kind: 'text', text: event.clipboardData.getData('text/plain') });
                }}
            />
            {!imageReady && !visibleError && <div className="absolute inset-0 grid place-items-center text-xs text-text-muted">Starting browser…</div>}
            {visibleError && (
                <div className="absolute inset-0 grid place-items-center bg-bg/90 px-6 text-center text-xs text-text-muted" role="alert">
                    <EmptyState icon={<Icon icon={CircleAlert} size={24} />}>{visibleError}</EmptyState>
                </div>
            )}
        </div>
    );
}
