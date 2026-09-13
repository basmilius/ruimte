import { describe, expect, test } from 'bun:test';
import { cameraCenteredOn, cameraToFit, isMeasured, toWorld, type Rect } from './math';

const node: Rect = { x: 1000, y: 600, w: 200, h: 100 };
const viewport = { w: 1200, h: 800 };

describe('the camera on a node', () => {
    test('puts the middle of the node in the middle of the viewport', () => {
        const camera = cameraCenteredOn(node, viewport, 1)!;
        expect(toWorld(camera, { x: viewport.w / 2, y: viewport.h / 2 })).toEqual({ x: 1100, y: 650 });
    });

    test('holds the middle at every zoom', () => {
        for (const zoom of [0.5, 0.75, 1, 2]) {
            const camera = cameraCenteredOn(node, viewport, zoom)!;
            expect(camera.zoom).toBe(zoom);
            expect(toWorld(camera, { x: viewport.w / 2, y: viewport.h / 2 })).toEqual({ x: 1100, y: 650 });
        }
    });

    /* The bug this answers: a camera worked out against a viewport of zero puts the node's middle at
       screen (0, 0), which reads as centering that dumps the node in the top left corner. */
    test('is null while the viewport is unmeasured, rather than a camera at the origin', () => {
        expect(cameraCenteredOn(node, { w: 0, h: 0 }, 1)).toBeNull();
        expect(cameraCenteredOn(node, { w: 1200, h: 0 }, 1)).toBeNull();
        expect(cameraCenteredOn(node, { w: 0, h: 800 }, 1)).toBeNull();
    });
});

describe('the camera on everything', () => {
    test('puts the middle of the bounds in the middle of the viewport', () => {
        const camera = cameraToFit({ x: 0, y: 0, w: 400, h: 200 }, viewport)!;
        expect(toWorld(camera, { x: viewport.w / 2, y: viewport.h / 2 })).toEqual({ x: 200, y: 100 });
    });

    test('is null while the viewport is unmeasured', () => {
        expect(cameraToFit({ x: 0, y: 0, w: 400, h: 200 }, { w: 0, h: 0 })).toBeNull();
        expect(isMeasured({ w: 0, h: 0 })).toBe(false);
        expect(isMeasured(viewport)).toBe(true);
    });
});
