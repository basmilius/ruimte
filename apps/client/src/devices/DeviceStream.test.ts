import { describe, expect, test } from 'bun:test';
import {
    approachGestureTotal,
    boundedGestureDelta,
    deviceScrollDelta,
    dominantGestureAxis,
    hevcKeyFrame,
    pinchPoints,
    positionInContainedFrame,
    trackpadGesturePoint
} from './device-layout';
import { HevcDecoderGate } from './hevc-decoder';

describe('hevcKeyFrame', () => {
    test('recognizes IRAP units in three and four byte Annex-B framing', () => {
        expect(hevcKeyFrame(new Uint8Array([0, 0, 0, 1, 19 << 1, 1]))).toBe(true);
        expect(hevcKeyFrame(new Uint8Array([0, 0, 1, 21 << 1, 1, 2]))).toBe(true);
        expect(hevcKeyFrame(new Uint8Array([0, 0, 0, 1, 1 << 1, 1]))).toBe(false);
    });
});

describe('HevcDecoderGate', () => {
    const delta = new Uint8Array([0, 0, 0, 1, 1 << 1, 1]);
    const key = new Uint8Array([0, 0, 0, 1, 19 << 1, 1]);

    test('waits for a key frame after configure and recovery', () => {
        const gate = new HevcDecoderGate();

        expect(gate.accept(delta, 0)).toBeNull();
        expect(gate.accept(key, 0)).toBe('key');
        expect(gate.accept(delta, 0)).toBe('delta');

        gate.reset();
        expect(gate.accept(delta, 0)).toBeNull();
        expect(gate.accept(key, 0)).toBe('key');
    });

    test('drops queued delta frames without losing the next key frame', () => {
        const gate = new HevcDecoderGate();

        expect(gate.accept(key, 0)).toBe('key');
        expect(gate.accept(delta, 9)).toBeNull();
        expect(gate.accept(key, 9)).toBe('key');
    });
});

describe('positionInContainedFrame', () => {
    test('maps a portrait device inside a landscape viewport', () => {
        const bounds = { left: 10, top: 20, width: 1_000, height: 500 };
        const frame = { width: 100, height: 200 };

        expect(positionInContainedFrame({ clientX: 385, clientY: 20 }, bounds, frame)).toEqual({ x: 0, y: 0 });
        expect(positionInContainedFrame({ clientX: 510, clientY: 270 }, bounds, frame)).toEqual({ x: 0.5, y: 0.5 });
        expect(positionInContainedFrame({ clientX: 635, clientY: 520 }, bounds, frame)).toEqual({ x: 1, y: 1 });
    });

    test('clamps input in the letterbox area to the device edge', () => {
        const bounds = { left: 0, top: 0, width: 1_000, height: 500 };
        const frame = { width: 100, height: 200 };

        expect(positionInContainedFrame({ clientX: 0, clientY: 250 }, bounds, frame)).toEqual({ x: 0, y: 0.5 });
        expect(positionInContainedFrame({ clientX: 1_000, clientY: 250 }, bounds, frame)).toEqual({ x: 1, y: 0.5 });
    });
});

describe('simulator gestures', () => {
    test('scales trackpad deltas from the rendered canvas to device pixels', () => {
        expect(deviceScrollDelta({ deltaX: 5, deltaY: -10, deltaMode: 0 }, { width: 300, height: 600 }, { width: 1_200, height: 2_400 })).toEqual({
            deltaX: 20,
            deltaY: -40
        });
        expect(deviceScrollDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 }, { width: 300, height: 600 }, { width: 1_200, height: 2_400 })).toEqual({
            deltaX: 0,
            deltaY: 192
        });
    });

    test('caps a momentum burst while preserving small and reversing deltas', () => {
        expect(boundedGestureDelta(0, 20, 100)).toEqual({ delta: 20, total: 20 });
        expect(boundedGestureDelta(80, 50, 100)).toEqual({ delta: 20, total: 100 });
        expect(boundedGestureDelta(100, 30, 100)).toEqual({ delta: 0, total: 100 });
        expect(boundedGestureDelta(100, -40, 100)).toEqual({ delta: -40, total: 60 });
    });

    test('spreads a large trackpad delta across frames without delaying a reversal', () => {
        expect(approachGestureTotal(0, 300, 30)).toBe(30);
        expect(approachGestureTotal(30, 300, 30)).toBe(60);
        expect(approachGestureTotal(60, 42, 30)).toBe(42);
        expect(approachGestureTotal(42, -100, 30)).toBe(12);
    });

    test('locks trackpad motion to its dominant axis and maps content motion to a finger drag', () => {
        expect(dominantGestureAxis({ deltaX: 80, deltaY: 12 })).toBe('x');
        expect(dominantGestureAxis({ deltaX: 3, deltaY: -20 })).toBe('y');
        expect(trackpadGesturePoint('x', { x: 0.5, y: 0.3 }, 200, { width: 1_000, height: 2_000 })).toEqual({ x: 0.3, y: 0.3 });
        expect(trackpadGesturePoint('y', { x: 0.7, y: 0.5 }, -400, { width: 1_000, height: 2_000 })).toEqual({ x: 0.7, y: 0.7 });
    });

    test('keeps synthesized pinch fingers inside the screen', () => {
        expect(pinchPoints({ x: 0.5, y: 0.25 }, 0.2)).toEqual([
            { x: 0.3, y: 0.25 },
            { x: 0.7, y: 0.25 }
        ]);
        expect(pinchPoints({ x: 0.05, y: 0.5 }, 0.2)).toEqual([
            { x: 0, y: 0.5 },
            { x: 0.25, y: 0.5 }
        ]);
    });
});
