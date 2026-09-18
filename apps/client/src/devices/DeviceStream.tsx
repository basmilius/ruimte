import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject, type WheelEvent as ReactWheelEvent } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import {
    HEVC_STREAM_CONTENT_TYPE,
    LiveStreamDecoder,
    LIVE_STREAM_CONTENT_TYPE,
    type DeviceInfo,
    type DeviceInput,
    type LiveStreamFrame
} from '@ruimte/contracts';
import { credentialFor } from '@/endpoint/credentials';
import {
    approachGestureTotal,
    boundedGestureDelta,
    deviceScrollDelta,
    dominantGestureAxis,
    hevcKeyFrame,
    pinchPoints,
    positionInContainedFrame,
    trackpadGesturePoint
} from '@/devices/device-layout';
import { useEndpoints } from '@/state/endpoints';
import { useEndpointId } from '@/state/keys';
import { deviceClientFor } from '@/transport/connections';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';

const RETRY_MS = 1_000;
const BOTTOM_EDGE_START = 0.92;
const TRACKPAD_DRAG_GAIN = 0.42;
const TRACKPAD_DRAG_LIMIT = 0.3;
const TRACKPAD_MAX_SPEED = 1.8;
const TRACKPAD_GESTURE_GAP_MS = 70;

/* Chromium 151 marks the coasting samples after the fingers lift; DOM typings do not expose it yet. */
type MomentumWheelEvent = WheelEvent & { momentum?: boolean };

interface TrackedPointer {
    x: number;
    y: number;
    edge?: 'bottom';
}

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
    private videoDecoder: VideoDecoder | null = null;

    constructor(canvas: RefObject<HTMLCanvasElement | null>, painted: () => void, failed: (message: string) => void) {
        this.canvas = canvas;
        this.painted = painted;
        this.failed = failed;
    }

    push(frame: LiveStreamFrame): void {
        if (frame.format === 'hevc') {
            this.decodeVideo(frame);
            return;
        }
        this.pending = frame;
        if (!this.drawing) {
            void this.draw();
        }
    }

    close(): void {
        this.pending = null;
        this.videoDecoder?.close();
        this.videoDecoder = null;
    }

    private decodeVideo(frame: LiveStreamFrame): void {
        if (!('VideoDecoder' in window)) {
            this.failed('This browser cannot decode the device video stream');
            return;
        }
        if (!this.videoDecoder || this.videoDecoder.state === 'closed') {
            this.videoDecoder = new VideoDecoder({
                output: (videoFrame) => {
                    const canvas = this.canvas.current;
                    if (canvas) {
                        canvas.width = videoFrame.displayWidth;
                        canvas.height = videoFrame.displayHeight;
                        canvas.getContext('2d', { alpha: false })?.drawImage(videoFrame, 0, 0, canvas.width, canvas.height);
                        this.painted();
                    }
                    videoFrame.close();
                },
                error: (error) => this.failed(error.message)
            });
            this.videoDecoder.configure({ codec: 'hev1.1.6.L93.B0', hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true });
        }
        const keyFrame = hevcKeyFrame(frame.data);
        if (this.videoDecoder.decodeQueueSize > 8 && !keyFrame) {
            return;
        }
        this.videoDecoder.decode(
            new EncodedVideoChunk({ type: keyFrame ? 'key' : 'delta', timestamp: frame.sequence * 16_667, data: frame.data.slice().buffer })
        );
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
            this.failed(error instanceof Error ? error.message : 'A simulator frame could not be drawn');
        } finally {
            this.drawing = false;
            if (this.pending) {
                void this.draw();
            }
        }
    }
}

export function DeviceStream({ device }: { device: DeviceInfo }) {
    const endpointId = useEndpointId();
    const endpoint = useEndpoints((state) => state.endpoints.find((entry) => entry.id === endpointId) ?? null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const pointers = useRef(new Map<number, TrackedPointer>());
    const pointerMode = useRef<'none' | 'single' | 'multi' | 'draining'>('none');
    const trackpad = useRef({
        active: false,
        exhausted: false,
        axis: null as 'x' | 'y' | null,
        total: 0,
        sent: 0,
        extent: 1,
        finishing: false,
        lastFrameAt: null as number | null,
        start: { x: 0.5, y: 0.5 },
        point: { x: 0.5, y: 0.5 },
        frame: null as number | null,
        timer: null as number | null
    });
    const pinch = useRef({ active: false, spread: 0.12, center: { x: 0.5, y: 0.5 }, timer: null as number | null });
    const [streamId, setStreamId] = useState<string | null>(null);
    const [imageReady, setImageReady] = useState(false);
    const [streamError, setStreamError] = useState<string | null>(null);
    const direct = endpoint?.direct === true;
    const target = useMemo(
        () => ({ backendId: device.backendId, platform: device.platform, deviceId: device.deviceId }),
        [device.backendId, device.deviceId, device.platform]
    );
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

    useEffect(() => {
        const client = deviceClientFor(endpointId);
        if (!client) {
            return;
        }
        let mounted = true;
        const stopStream = client.onStream(target, (id) => {
            if (mounted) {
                setStreamId(id);
                setStreamError(null);
            }
        });
        void client.open(target, direct ? 'events' : 'http').then(
            (id) => mounted && setStreamId(id),
            (error) => mounted && setStreamError(error instanceof Error ? error.message : 'The simulator could not start streaming')
        );
        return () => {
            mounted = false;
            stopStream();
            void client.detach(target);
        };
    }, [direct, endpointId, target]);

    useEffect(() => {
        if (!direct) {
            return;
        }
        return deviceClientFor(endpointId)?.onFrame(target, (frame) => framePainter.push(frame));
    }, [direct, endpointId, framePainter, target]);

    useEffect(() => {
        if (direct || !endpoint || !streamId) {
            return;
        }
        const controller = new AbortController();
        const consume = async (): Promise<void> => {
            while (!controller.signal.aborted) {
                try {
                    const credential = credentialFor(endpoint);
                    const headers = credential ? { Authorization: `Bearer ${credential}` } : undefined;
                    const response = await fetch(`${endpoint.httpBaseUrl}/live-stream/${encodeURIComponent(streamId)}`, { headers, signal: controller.signal });
                    if (!response.ok || !response.body) {
                        throw new Error(response.status === 404 ? 'The device stream is not ready yet' : `The device stream returned ${response.status}`);
                    }
                    const contentType = response.headers.get('content-type') ?? '';
                    const hevc = contentType.startsWith(HEVC_STREAM_CONTENT_TYPE.split(';')[0]!);
                    if (!hevc && !contentType.startsWith(LIVE_STREAM_CONTENT_TYPE.split(';')[0]!)) {
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
                            framePainter.push(hevc ? { ...frame, format: 'hevc' } : frame);
                        }
                    }
                } catch (error) {
                    if (!controller.signal.aborted) {
                        setStreamError(error instanceof Error ? error.message : 'The simulator stream stopped');
                    }
                }
                await wait(RETRY_MS, controller.signal);
            }
        };
        void consume();
        return () => controller.abort();
    }, [direct, endpoint, framePainter, streamId]);

    useEffect(
        () => () => {
            framePainter.close();
            if (trackpad.current.frame !== null) {
                window.cancelAnimationFrame(trackpad.current.frame);
            }
            if (trackpad.current.timer !== null) {
                window.clearTimeout(trackpad.current.timer);
            }
            if (trackpad.current.active) {
                deviceClientFor(endpointId)?.input(target, { kind: 'pointer', phase: 'up', ...trackpad.current.point });
            }
            if (pinch.current.timer !== null) {
                window.clearTimeout(pinch.current.timer);
            }
        },
        [endpointId, framePainter, target]
    );

    const position = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
        const element = canvas.current!;
        return positionInContainedFrame(event, element.getBoundingClientRect(), element);
    };
    const sendInput = (input: DeviceInput): void => {
        if (device.capabilities.input) {
            deviceClientFor(endpointId)?.input(target, input);
        }
    };
    const releaseTrackpadGesture = (flush = false): void => {
        const state = trackpad.current;
        if (state.frame !== null) {
            window.cancelAnimationFrame(state.frame);
            state.frame = null;
        }
        if (flush && state.active && state.sent !== state.total) {
            state.sent = state.total;
            state.point = trackpadGesturePoint(state.axis!, state.start, state.sent, canvas.current ?? { width: 1, height: 1 });
            sendInput({ kind: 'pointer', phase: 'move', ...state.point });
        }
        if (state.active) {
            sendInput({ kind: 'pointer', phase: 'up', ...state.point });
        }
        if (state.timer !== null) {
            window.clearTimeout(state.timer);
        }
        state.active = false;
        state.exhausted = false;
        state.axis = null;
        state.total = 0;
        state.sent = 0;
        state.extent = 1;
        state.finishing = false;
        state.lastFrameAt = null;
        state.timer = null;
    };
    const advanceTrackpadGesture = (timestamp: number): void => {
        const state = trackpad.current;
        state.frame = null;
        if (!state.active || !state.axis) {
            return;
        }
        const elapsed = state.lastFrameAt === null ? 1_000 / 60 : Math.max(1, Math.min(32, timestamp - state.lastFrameAt));
        state.lastFrameAt = timestamp;
        const next = approachGestureTotal(state.sent, state.total, state.extent * TRACKPAD_MAX_SPEED * (elapsed / 1_000));
        if (next !== state.sent) {
            state.sent = next;
            state.point = trackpadGesturePoint(state.axis, state.start, state.sent, canvas.current ?? { width: 1, height: 1 });
            sendInput({ kind: 'pointer', phase: 'move', ...state.point });
        }
        if (state.sent !== state.total) {
            state.frame = window.requestAnimationFrame(advanceTrackpadGesture);
        } else if (state.finishing) {
            state.frame = window.requestAnimationFrame(() => {
                state.frame = null;
                if (state.finishing && state.sent === state.total) {
                    releaseTrackpadGesture();
                } else {
                    state.frame = window.requestAnimationFrame(advanceTrackpadGesture);
                }
            });
        }
    };
    const settleTrackpadGesture = (): void => {
        const state = trackpad.current;
        state.finishing = true;
        if (state.frame === null) {
            if (state.sent === state.total) {
                state.frame = window.requestAnimationFrame(() => {
                    state.frame = null;
                    if (state.finishing && state.sent === state.total) {
                        releaseTrackpadGesture();
                    } else if (state.active && state.sent !== state.total) {
                        state.frame = window.requestAnimationFrame(advanceTrackpadGesture);
                    }
                });
            } else {
                state.frame = window.requestAnimationFrame(advanceTrackpadGesture);
            }
        }
    };
    const sendMultiPointer = (phase: 'down' | 'move' | 'up'): void => {
        const [first, second] = [...pointers.current.values()];
        if (first && second) {
            sendInput({
                kind: 'multiPointer',
                phase,
                first: { x: first.x, y: first.y },
                second: { x: second.x, y: second.y }
            });
        }
    };
    const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
        if (pointerMode.current === 'draining' || pointers.current.size >= 2) {
            return;
        }
        releaseTrackpadGesture(true);
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = position(event);
        if (pointers.current.size === 0) {
            const pointer: TrackedPointer = { ...point, edge: point.y >= BOTTOM_EDGE_START ? 'bottom' : undefined };
            pointers.current.set(event.pointerId, pointer);
            pointerMode.current = 'single';
            sendInput({ kind: 'pointer', phase: 'down', ...pointer });
            return;
        }
        const first = pointers.current.values().next().value as TrackedPointer;
        sendInput({ kind: 'pointer', phase: 'up', ...first });
        pointers.current.set(event.pointerId, point);
        pointerMode.current = 'multi';
        sendMultiPointer('down');
    };
    const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
        if (!pointers.current.has(event.pointerId)) {
            return;
        }
        const previous = pointers.current.get(event.pointerId)!;
        pointers.current.set(event.pointerId, { ...position(event), edge: previous.edge });
        if (pointerMode.current === 'single') {
            sendInput({ kind: 'pointer', phase: 'move', ...pointers.current.get(event.pointerId)! });
        } else if (pointerMode.current === 'multi') {
            sendMultiPointer('move');
        }
    };
    const endPointer = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
        if (!pointers.current.has(event.pointerId)) {
            return;
        }
        const previous = pointers.current.get(event.pointerId)!;
        pointers.current.set(event.pointerId, { ...position(event), edge: previous.edge });
        if (pointerMode.current === 'single') {
            sendInput({ kind: 'pointer', phase: 'up', ...pointers.current.get(event.pointerId)! });
        } else if (pointerMode.current === 'multi') {
            sendMultiPointer('up');
        }
        pointers.current.delete(event.pointerId);
        pointerMode.current = pointers.current.size === 0 ? 'none' : 'draining';
    };
    const onWheel = (event: ReactWheelEvent<HTMLCanvasElement>): void => {
        const element = canvas.current;
        if (!element || element.width === 0 || element.height === 0) {
            return;
        }
        event.preventDefault();
        const center = position(event);
        if (event.ctrlKey) {
            releaseTrackpadGesture(true);
            const state = pinch.current;
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.getBoundingClientRect().height : 1;
            state.center = center;
            if (!state.active) {
                state.active = true;
                state.spread = 0.12;
                const [first, second] = pinchPoints(center, state.spread);
                sendInput({ kind: 'multiPointer', phase: 'down', first, second });
            }
            state.spread = Math.max(0.03, Math.min(0.42, state.spread * Math.exp(-event.deltaY * unit * 0.01)));
            const [first, second] = pinchPoints(center, state.spread);
            sendInput({ kind: 'multiPointer', phase: 'move', first, second });
            if (state.timer !== null) {
                window.clearTimeout(state.timer);
            }
            state.timer = window.setTimeout(() => {
                const [lastFirst, lastSecond] = pinchPoints(state.center, state.spread);
                sendInput({ kind: 'multiPointer', phase: 'up', first: lastFirst, second: lastSecond });
                state.active = false;
                state.timer = null;
            }, 120);
            return;
        }
        if (pointers.current.size > 0 || pinch.current.active) {
            return;
        }
        const state = trackpad.current;
        if ((event.nativeEvent as MomentumWheelEvent).momentum === true) {
            if (state.active) {
                settleTrackpadGesture();
            }
            return;
        }
        if (state.finishing) {
            releaseTrackpadGesture();
        }
        if (state.exhausted) {
            if (state.timer !== null) {
                window.clearTimeout(state.timer);
            }
            state.timer = window.setTimeout(settleTrackpadGesture, TRACKPAD_GESTURE_GAP_MS);
            return;
        }
        const delta = deviceScrollDelta(event, element.getBoundingClientRect(), element);
        if (delta.deltaX === 0 && delta.deltaY === 0) {
            return;
        }
        const axis = state.axis ?? dominantGestureAxis(delta);
        if (!state.active) {
            state.active = true;
            state.axis = axis;
            state.start = axis === 'x' ? { x: 0.5, y: Math.max(0.08, Math.min(0.92, center.y)) } : { x: Math.max(0.08, Math.min(0.92, center.x)), y: 0.5 };
            state.point = state.start;
            state.extent = axis === 'x' ? element.width : element.height;
            state.lastFrameAt = null;
            sendInput({ kind: 'pointer', phase: 'down', ...state.start });
        }
        state.finishing = false;
        const extent = state.extent;
        const rawDelta = axis === 'x' ? delta.deltaX : delta.deltaY;
        const movement = boundedGestureDelta(state.total, rawDelta * TRACKPAD_DRAG_GAIN, extent * TRACKPAD_DRAG_LIMIT);
        state.total = movement.total;
        state.exhausted = Math.abs(state.total) >= extent * TRACKPAD_DRAG_LIMIT;
        if (state.timer !== null) {
            window.clearTimeout(state.timer);
        }
        state.timer = window.setTimeout(settleTrackpadGesture, TRACKPAD_GESTURE_GAP_MS);
        if (state.frame === null && movement.delta !== 0) {
            state.frame = window.requestAnimationFrame(advanceTrackpadGesture);
        }
    };

    return (
        <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-black">
            <canvas
                ref={canvas}
                className="block h-auto max-h-full w-auto max-w-full touch-none outline-none"
                aria-label={`${device.name} screen`}
                tabIndex={0}
                onContextMenu={(event) => event.preventDefault()}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endPointer}
                onPointerCancel={endPointer}
                onWheel={onWheel}
            />
            {!imageReady && !streamError && (
                <div className="absolute inset-0 grid place-items-center text-xs text-text-muted">
                    <span className="flex items-center gap-2">
                        <Icon icon={LoaderCircle} size={14} className="animate-spin" /> Starting device...
                    </span>
                </div>
            )}
            {streamError && (
                <div className="absolute inset-0 grid place-items-center bg-bg/90 px-6 text-center" role="alert">
                    <EmptyState icon={<Icon icon={CircleAlert} size={24} />}>{streamError}</EmptyState>
                </div>
            )}
        </div>
    );
}
