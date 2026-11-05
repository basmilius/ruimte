import { describe, expect, test } from 'bun:test';
import type { FrameClock } from './pan-batch';
import { createZoomGlide, NOTCH_FACTOR, wheelZoomOf } from './wheel-zoom';

describe('wheelZoomOf', () => {
    test('a notch of a mouse wheel is a step of ten percent, in or out', () => {
        expect(wheelZoomOf({ deltaY: -100, deltaMode: 0 })).toEqual({ kind: 'notch', factor: NOTCH_FACTOR });
        expect(wheelZoomOf({ deltaY: 100, deltaMode: 0 })).toEqual({ kind: 'notch', factor: 1 / NOTCH_FACTOR });
    });

    test('a notch under display scaling is still one step', () => {
        expect(wheelZoomOf({ deltaY: -125, deltaMode: 0 })).toEqual({ kind: 'notch', factor: NOTCH_FACTOR });
    });

    test('several notches in one event take as many steps', () => {
        const step = wheelZoomOf({ deltaY: -300, deltaMode: 0 });
        expect(step.kind).toBe('notch');
        expect(step.factor).toBeCloseTo(NOTCH_FACTOR ** 3);
    });

    test('a wheel that counts in lines is a notch too', () => {
        expect(wheelZoomOf({ deltaY: 3, deltaMode: 1 })).toEqual({ kind: 'notch', factor: 1 / NOTCH_FACTOR });
    });

    test('a pinch follows the fingers, and one coarse event cannot jump', () => {
        const small = wheelZoomOf({ deltaY: -4, deltaMode: 0 });
        expect(small.kind).toBe('pinch');
        expect(small.factor).toBeCloseTo(Math.exp(0.04));
        expect(wheelZoomOf({ deltaY: 39, deltaMode: 0 }).factor).toBeCloseTo(Math.exp(-0.25));
    });
});

/* Frames that run only when the test says so. */
function manualFrames(): FrameClock & { run(): void; pending(): number } {
    let queue: Array<() => void> = [];
    return {
        request(run) {
            queue.push(run);
            return queue.length;
        },
        cancel() {
            queue = [];
        },
        run() {
            const due = queue;
            queue = [];
            for (const run of due) {
                run();
            }
        },
        pending: () => queue.length
    };
}

function glideCamera(start: number) {
    let zoom = start;
    return {
        zoom: () => zoom,
        zoomAt: (factor: number) => {
            zoom *= factor;
        }
    };
}

describe('createZoomGlide', () => {
    test('moves over several frames, lands on the target and settles once', () => {
        const frames = manualFrames();
        const camera = glideCamera(1);
        const settled: number[] = [];
        const glide = createZoomGlide(camera, () => settled.push(camera.zoom()), frames);

        glide.add(NOTCH_FACTOR, { x: 10, y: 20 });
        frames.run();
        // The first frame takes a share of the way, not all of it.
        expect(camera.zoom()).toBeGreaterThan(1);
        expect(camera.zoom()).toBeLessThan(NOTCH_FACTOR);

        for (let i = 0; i < 60 && frames.pending() > 0; i++) {
            frames.run();
        }
        expect(camera.zoom()).toBeCloseTo(NOTCH_FACTOR, 10);
        expect(settled).toHaveLength(1);
    });

    test('notches that come in while it moves add up to as many steps', () => {
        const frames = manualFrames();
        const camera = glideCamera(1);
        const glide = createZoomGlide(camera, () => undefined, frames);

        glide.add(NOTCH_FACTOR, { x: 0, y: 0 });
        frames.run();
        glide.add(NOTCH_FACTOR, { x: 0, y: 0 });
        glide.add(NOTCH_FACTOR, { x: 0, y: 0 });
        for (let i = 0; i < 60 && frames.pending() > 0; i++) {
            frames.run();
        }
        expect(camera.zoom()).toBeCloseTo(NOTCH_FACTOR ** 3, 10);
    });

    test('stays within the zoom range', () => {
        const frames = manualFrames();
        const camera = glideCamera(3.9);
        const glide = createZoomGlide(camera, () => undefined, frames);
        for (let i = 0; i < 5; i++) {
            glide.add(NOTCH_FACTOR, { x: 0, y: 0 });
        }
        for (let i = 0; i < 60 && frames.pending() > 0; i++) {
            frames.run();
        }
        expect(camera.zoom()).toBeCloseTo(4, 10);
    });

    test('a stop leaves the camera where it is and settles nothing', () => {
        const frames = manualFrames();
        const camera = glideCamera(1);
        let settled = 0;
        const glide = createZoomGlide(camera, () => settled++, frames);
        glide.add(NOTCH_FACTOR, { x: 0, y: 0 });
        frames.run();
        const halfway = camera.zoom();
        glide.stop();
        frames.run();
        expect(camera.zoom()).toBe(halfway);
        expect(settled).toBe(0);
    });
});
