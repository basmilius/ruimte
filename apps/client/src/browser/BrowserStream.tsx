import { useEffect, useRef, useState, type RefObject } from 'react';
import { LiveStreamDecoder, LIVE_STREAM_CONTENT_TYPE, type BrowserInput, type LiveStreamFrame } from '@ruimte/contracts';
import { CircleAlert } from 'lucide-react';
import { browserClientFor } from '@/transport/connections';
import { credentialFor } from '@/endpoint/credentials';
import { useEndpointId } from '@/state/keys';
import { useEndpoints } from '@/state/endpoints';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { initialStreamUrl, useBrowserRow } from './registry';
import { browserStreamScaleLimit, clampBrowserStreamScale, useBrowserStreamQuality } from './stream-quality';

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

class FramePainter {
    private readonly canvas: RefObject<HTMLCanvasElement | null>;
    private drawing = false;
    private readonly failed: (message: string) => void;
    private readonly painted: () => void;
    private pending: LiveStreamFrame | null = null;

    constructor(canvas: RefObject<HTMLCanvasElement | null>, painted: () => void, failed: (message: string) => void) {
        this.canvas = canvas;
        this.painted = painted;
        this.failed = failed;
    }

    push(frame: LiveStreamFrame): void {
        this.pending = frame;
        if (!this.drawing) {
            void this.draw();
        }
    }

    private async draw(): Promise<void> {
        this.drawing = true;
        try {
            while (this.pending) {
                const frame = this.pending;
                this.pending = null;
                const bitmap = await createImageBitmap(new Blob([frame.data.slice().buffer], { type: 'image/jpeg' }));
                const canvas = this.canvas.current;
                if (canvas) {
                    canvas.width = frame.width;
                    canvas.height = frame.height;
                    canvas.getContext('2d', { alpha: false })?.drawImage(bitmap, 0, 0, frame.width, frame.height);
                    this.painted();
                }
                bitmap.close();
            }
        } catch (error) {
            this.failed(error instanceof Error ? error.message : 'A frame could not be drawn');
        } finally {
            this.drawing = false;
            if (this.pending) {
                void this.draw();
            }
        }
    }
}

export function BrowserStream({ id, initialUrl: savedUrl, className }: { id: string; initialUrl: string; className?: string }) {
    const endpointId = useEndpointId();
    const endpoint = useEndpoints((state) => state.endpoints.find((entry) => entry.id === endpointId) ?? null);
    const row = useBrowserRow(id, (state) => state);
    const host = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const viewportSize = useRef({ width: 1, height: 1 });
    const moveFrame = useRef<number | null>(null);
    const pendingMove = useRef<BrowserInput | null>(null);
    const initialUrl = useRef(initialStreamUrl(savedUrl, row?.url));
    const preferredScale = useBrowserStreamQuality((state) => state.scale);
    const scale = clampBrowserStreamScale(preferredScale, browserStreamScaleLimit());
    const scaleRef = useRef(scale);
    const appliedScale = useRef(scale);
    const [ready, setReady] = useState(false);
    const [imageReady, setImageReady] = useState(false);
    const [streamError, setStreamError] = useState<string | null>(null);
    const direct = endpoint?.direct === true;
    const streamId = row?.streamId ?? `browser:${id}`;
    const [framePainter] = useState(
        () =>
            new FramePainter(
                canvas,
                () => {
                    setImageReady(true);
                    setStreamError(null);
                },
                setStreamError
            )
    );

    useEffect(
        () => () => {
            if (moveFrame.current !== null) {
                cancelAnimationFrame(moveFrame.current);
            }
        },
        []
    );

    useEffect(() => {
        const client = browserClientFor(endpointId);
        const element = host.current;
        if (!client || !element) {
            return;
        }
        const rect = element.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width || 800));
        const height = Math.max(1, Math.round(rect.height || 600));
        viewportSize.current = { width, height };
        let mounted = true;
        setReady(false);
        setImageReady(false);
        setStreamError(null);
        appliedScale.current = scaleRef.current;
        void client.open(id, initialUrl.current, width, height, direct ? 'events' : 'http', scaleRef.current).then(
            () => mounted && setReady(true),
            (error) => mounted && setStreamError(error instanceof Error ? error.message : 'The browser could not start')
        );
        const observer = new ResizeObserver(([entry]) => {
            if (!entry) {
                return;
            }
            const nextWidth = Math.max(1, Math.round(entry.contentRect.width));
            const nextHeight = Math.max(1, Math.round(entry.contentRect.height));
            viewportSize.current = { width: nextWidth, height: nextHeight };
            void client.resize(id, nextWidth, nextHeight, scaleRef.current);
        });
        observer.observe(element);
        return () => {
            mounted = false;
            observer.disconnect();
            void client.detach(id);
        };
    }, [direct, endpointId, id]);

    useEffect(() => {
        scaleRef.current = scale;
        if (appliedScale.current === scale) {
            return;
        }
        appliedScale.current = scale;
        const { width, height } = viewportSize.current;
        void browserClientFor(endpointId)?.resize(id, width, height, scale);
    }, [endpointId, id, scale]);

    useEffect(() => {
        if (!direct) {
            return;
        }
        return browserClientFor(endpointId)?.onFrame(id, (frame) => framePainter.push(frame));
    }, [direct, endpointId, framePainter, id]);

    useEffect(() => {
        if (!ready || direct || !endpoint) {
            return;
        }
        const controller = new AbortController();

        const consume = async (): Promise<void> => {
            while (!controller.signal.aborted) {
                try {
                    const credential = credentialFor(endpoint);
                    const headers = credential ? { Authorization: `Bearer ${credential}` } : undefined;
                    const response = await fetch(`${endpoint.httpBaseUrl}/live-stream/${encodeURIComponent(streamId)}`, {
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
                            framePainter.push(frame);
                        }
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
    }, [direct, endpoint, framePainter, id, ready, streamId]);

    const send = (input: BrowserInput): void => browserClientFor(endpointId)?.input(id, input);
    const position = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
        const rect = canvas.current!.getBoundingClientRect();
        return {
            x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * viewportSize.current.width,
            y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * viewportSize.current.height
        };
    };

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
