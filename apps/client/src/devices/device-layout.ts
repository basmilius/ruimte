interface DevicePoint {
    clientX: number;
    clientY: number;
}

interface DeviceBounds {
    left: number;
    top: number;
    width: number;
    height: number;
}

export type GestureAxis = 'x' | 'y';

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));

export const positionInContainedFrame = (point: DevicePoint, bounds: DeviceBounds, frame: { width: number; height: number }): { x: number; y: number } => {
    const scale = Math.min(bounds.width / Math.max(1, frame.width), bounds.height / Math.max(1, frame.height));
    const width = frame.width * scale;
    const height = frame.height * scale;
    const left = bounds.left + (bounds.width - width) / 2;
    const top = bounds.top + (bounds.height - height) / 2;
    return {
        x: clamp((point.clientX - left) / Math.max(1, width), 0, 1),
        y: clamp((point.clientY - top) / Math.max(1, height), 0, 1)
    };
};

export const deviceScrollDelta = (
    wheel: { deltaX: number; deltaY: number; deltaMode: number },
    bounds: Pick<DeviceBounds, 'width' | 'height'>,
    frame: { width: number; height: number }
): { deltaX: number; deltaY: number } => {
    const unit = wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? bounds.height : 1;
    return {
        deltaX: clamp(wheel.deltaX * unit * (frame.width / Math.max(1, bounds.width)), -frame.width, frame.width),
        deltaY: clamp(wheel.deltaY * unit * (frame.height / Math.max(1, bounds.height)), -frame.height, frame.height)
    };
};

export const boundedGestureDelta = (total: number, delta: number, limit: number): { delta: number; total: number } => {
    const next = clamp(total + delta, -limit, limit);
    return { delta: next - total, total: next };
};

export const approachGestureTotal = (current: number, target: number, maximumStep: number): number =>
    current + clamp(target - current, -maximumStep, maximumStep);

export const dominantGestureAxis = (delta: { deltaX: number; deltaY: number }): GestureAxis => (Math.abs(delta.deltaX) >= Math.abs(delta.deltaY) ? 'x' : 'y');

export const trackpadGesturePoint = (
    axis: GestureAxis,
    start: { x: number; y: number },
    total: number,
    frame: { width: number; height: number }
): { x: number; y: number } => (axis === 'x' ? { x: start.x - total / frame.width, y: start.y } : { x: start.x, y: start.y - total / frame.height });

export const pinchPoints = (center: { x: number; y: number }, spread: number): [{ x: number; y: number }, { x: number; y: number }] => [
    { x: clamp(center.x - spread, 0, 1), y: center.y },
    { x: clamp(center.x + spread, 0, 1), y: center.y }
];
