import { EmptyState, Icon, messageOf } from '@adecore/ui';
import { deviceTools, liveStreamFormatOf, type DeviceInfo, type DeviceInput } from '@ruimte/contracts';
import clsx from 'clsx';
import i18next from 'i18next';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
    type WheelEvent as ReactWheelEvent
} from 'react';
import { useTranslation } from 'react-i18next';
import { isApplePlatform } from '@/desktop/bridge';
import { routeDeviceKey } from '@/devices/device-keys';
import {
    approachGestureTotal,
    boundedGestureDelta,
    deviceScrollDelta,
    dominantGestureAxis,
    pinchPoints,
    positionInContainedFrame,
    trackpadGesturePoint
} from '@/devices/device-layout';
import { DeviceTapPing } from '@/devices/DeviceOperatedStrip';
import { hidUsageOf } from '@/devices/hid-usages';
import { videoFrameDecoder } from '@/devices/video-decoder';
import { followLiveStream } from '@/endpoint/live-stream-fetch';
import { useEndpointId } from '@/state/current-endpoint';
import { useEndpoints } from '@/state/endpoints';
import { deviceClientFor } from '@/transport/connections';
import { FramePainter } from '@/transport/live-stream';

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

// The React Compiler leaves this as written (an optional chain inside a try), so its memo stays by hand.
export function DeviceStream({ device }: { device: DeviceInfo }) {
    const { t } = useTranslation('machines');
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
    /* The keys a person holds down on the device, let go when the screen loses the focus so none stays stuck. */
    const heldKeys = useRef(new Set<number>());
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
                {
                    canvas,
                    painted: () => {
                        setImageReady(true);
                        setStreamError(null);
                    },
                    failed: setStreamError,
                    undrawable: () => i18next.t('machines:device.stream.frameFailed')
                },
                videoFrameDecoder
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
            (error) => mounted && setStreamError(messageOf(error, i18next.t('machines:device.stream.startFailed')))
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
        void followLiveStream(endpoint, streamId, controller.signal, {
            formatOf: liveStreamFormatOf,
            onFrame: (frame, format) => framePainter.push({ ...frame, format }),
            onError: setStreamError,
            words: {
                notReady: () => i18next.t('machines:device.stream.notReady'),
                status: (status) => i18next.t('machines:device.stream.httpStatus', { status }),
                unknownFormat: () => i18next.t('machines:device.stream.unknownFormat'),
                stopped: () => i18next.t('machines:device.stream.stopped')
            }
        });
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
    const keyboard = device.capabilities.input && deviceTools(device).includes('keyboard');
    const onKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>): void => {
        if (!keyboard) {
            return;
        }
        const route = routeDeviceKey(
            { code: event.code, metaKey: event.metaKey, ctrlKey: event.ctrlKey, repeat: event.repeat, isComposing: event.nativeEvent.isComposing },
            isApplePlatform()
        );
        if (route.kind === 'pass') {
            return;
        }
        event.preventDefault();
        if (route.kind === 'paste') {
            void pasteClipboard();
        } else if (route.kind === 'key' && !heldKeys.current.has(route.usage)) {
            heldKeys.current.add(route.usage);
            sendInput({ kind: 'key', phase: 'down', usage: route.usage });
        }
    };
    const onKeyUp = (event: ReactKeyboardEvent<HTMLCanvasElement>): void => {
        const usage = hidUsageOf(event.code);
        if (usage !== null && heldKeys.current.delete(usage)) {
            event.preventDefault();
            sendInput({ kind: 'key', phase: 'up', usage });
        }
    };
    const releaseKeys = (): void => {
        for (const usage of heldKeys.current) {
            sendInput({ kind: 'key', phase: 'up', usage });
        }
        heldKeys.current.clear();
    };
    const pasteClipboard = async (): Promise<void> => {
        try {
            const text = await navigator.clipboard.readText();
            if (text !== '') {
                await deviceClientFor(endpointId)?.clipboard(target, text, true);
            }
        } catch (error) {
            setStreamError(messageOf(error, i18next.t('machines:device.tools.clipboard.failed')));
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
            releaseOnNextFrame();
        }
    };
    /* Lets go a frame after the last move landed, unless the gesture went on meanwhile. */
    const releaseOnNextFrame = (): void => {
        const state = trackpad.current;
        state.frame = window.requestAnimationFrame(() => {
            state.frame = null;
            if (state.finishing && state.sent === state.total) {
                releaseTrackpadGesture();
            } else if (state.active) {
                state.frame = window.requestAnimationFrame(advanceTrackpadGesture);
            }
        });
    };
    const settleTrackpadGesture = (): void => {
        const state = trackpad.current;
        state.finishing = true;
        if (state.frame !== null) {
            return;
        }
        if (state.sent === state.total) {
            releaseOnNextFrame();
        } else {
            state.frame = window.requestAnimationFrame(advanceTrackpadGesture);
        }
    };
    const settleAfterGap = (): void => {
        const state = trackpad.current;
        if (state.timer !== null) {
            window.clearTimeout(state.timer);
        }
        state.timer = window.setTimeout(settleTrackpadGesture, TRACKPAD_GESTURE_GAP_MS);
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
    /* Moves a tracked pointer to where the event is and sends it; false for a pointer this canvas does not track. */
    const followPointer = (event: ReactPointerEvent<HTMLCanvasElement>, phase: 'move' | 'up'): boolean => {
        const previous = pointers.current.get(event.pointerId);
        if (!previous) {
            return false;
        }
        const next = { ...position(event), edge: previous.edge };
        pointers.current.set(event.pointerId, next);
        if (pointerMode.current === 'single') {
            sendInput({ kind: 'pointer', phase, ...next });
        } else if (pointerMode.current === 'multi') {
            sendMultiPointer(phase);
        }
        return true;
    };
    const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
        followPointer(event, 'move');
    };
    const endPointer = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
        if (!followPointer(event, 'up')) {
            return;
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
            settleAfterGap();
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
        settleAfterGap();
        if (state.frame === null && movement.delta !== 0) {
            state.frame = window.requestAnimationFrame(advanceTrackpadGesture);
        }
    };

    return (
        <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-black">
            <canvas
                ref={canvas}
                // With a keyboard the ring says where the keys go, however the screen got the focus.
                className={clsx(
                    'block h-auto max-h-full w-auto max-w-full touch-none outline-none',
                    keyboard && 'focus:outline-2 focus:-outline-offset-2 focus:outline-accent'
                )}
                aria-label={t('device.stream.screen', { name: device.name })}
                tabIndex={0}
                onContextMenu={(event) => event.preventDefault()}
                onKeyDown={onKeyDown}
                onKeyUp={onKeyUp}
                onBlur={releaseKeys}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endPointer}
                onPointerCancel={endPointer}
                onWheel={onWheel}
            />
            <DeviceTapPing device={device} screen={canvas} />
            {!imageReady && !streamError && (
                <div className="absolute inset-0 grid place-items-center text-xs text-text-muted">
                    <span className="flex items-center gap-2">
                        <Icon icon={LoaderCircle} size={14} className="animate-spin" /> {t('device.stream.starting')}
                    </span>
                </div>
            )}
            {streamError && (
                <div className="absolute inset-0 grid place-items-center bg-bg/90 px-6 text-center" role="alert">
                    <EmptyState icon={CircleAlert}>{streamError}</EmptyState>
                </div>
            )}
        </div>
    );
}
