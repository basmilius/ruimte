import { describe, expect, test } from 'bun:test';
import { onlyCameraMoved } from '@/canvas/camera-slice';

describe('onlyCameraMoved', () => {
    const before = { camera: { x: 0, y: 0, zoom: 1 }, nodes: {}, selection: [] as string[] };

    test('is true when the camera alone changed', () => {
        expect(onlyCameraMoved({ ...before, camera: { x: 0, y: 0, zoom: 1.1 } }, before)).toBe(true);
    });

    test('is false when something beside the camera changed too', () => {
        expect(onlyCameraMoved({ ...before, camera: { x: 5, y: 0, zoom: 1 }, selection: ['note-a'] }, before)).toBe(false);
    });

    test('is false when the camera stayed', () => {
        expect(onlyCameraMoved({ ...before, nodes: {} }, before)).toBe(false);
    });
});
