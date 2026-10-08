import { describe, expect, test } from 'bun:test';
import { createCanvasStore } from '@/state/canvas';
import { createGuestCanvasInput } from './guest-canvas-input';

function canvas() {
    const store = createCanvasStore();
    store.setState({
        nodes: { page: { id: 'page', kind: 'browser', title: 'Page', x: 1000, y: 0, w: 1200, h: 800 } },
        selection: ['page'],
        bodyFocusId: 'page',
        viewport: { w: 800, h: 600 }
    });
    return store;
}

describe('canvas input from a browser guest', () => {
    test('middle-button panning uses screen deltas and keeps the page selected and focused', () => {
        const store = canvas();
        const input = createGuestCanvasInput(
            'page',
            () => store,
            () => {}
        );
        input.handle('ruimte:canvas-pan', { phase: 'start', x: 400, y: 400 });
        input.handle('ruimte:canvas-pan', { phase: 'move', x: 450, y: 420 });
        input.handle('ruimte:canvas-pan', { phase: 'move', x: 470, y: 430 });
        expect(store.getState().camera).toEqual({ x: 70, y: 30, zoom: 1 });
        expect(store.getState().selection).toEqual(['page']);
        expect(store.getState().bodyFocusId).toBe('page');
        expect(store.getState().panning).toBe(true);
        input.handle('ruimte:canvas-pan', { phase: 'end' });
        expect(store.getState().panning).toBe(false);
        expect(store.getState().gesturing).toBe(false);
    });

    test('a pan lock, a maximized page and invalid coordinates cannot start a pan', () => {
        const store = canvas();
        const input = createGuestCanvasInput(
            'page',
            () => store,
            () => {}
        );
        input.handle('ruimte:canvas-pan', { phase: 'start', x: Number.NaN, y: 400 });
        expect(input.isPanning()).toBe(false);
        store.getState().toggleLock('pan');
        input.handle('ruimte:canvas-pan', { phase: 'start', x: 400, y: 400 });
        expect(input.isPanning()).toBe(false);
        store.getState().toggleLock('pan');
        store.getState().toggleMaximizedNode('page');
        input.handle('ruimte:canvas-pan', { phase: 'start', x: 400, y: 400 });
        expect(input.isPanning()).toBe(false);
    });

    test('switching away during a pan releases the old canvas', () => {
        const store = canvas();
        let shown = true;
        const input = createGuestCanvasInput(
            'page',
            () => (shown ? store : null),
            () => {}
        );
        input.handle('ruimte:canvas-pan', { phase: 'start', x: 400, y: 400 });
        shown = false;
        input.handle('ruimte:canvas-pan', { phase: 'move', x: 450, y: 420 });
        expect(store.getState().camera.x).toBe(0);
        expect(store.getState().panning).toBe(false);
        expect(store.getState().gesturing).toBe(false);
    });

    test('zoom addresses its own node and leaving restores canvas keyboard focus', () => {
        const store = canvas();
        let left = false;
        const input = createGuestCanvasInput(
            'page',
            () => store,
            () => {
                left = true;
            }
        );
        input.handle('ruimte:canvas-zoom', undefined);
        expect(store.getState().camera.zoom).toBeCloseTo(0.5866667);
        expect(store.getState().bodyFocusId).toBe('page');
        input.handle('ruimte:canvas-leave', undefined);
        expect(left).toBe(true);
        expect(store.getState().bodyFocusId).toBeNull();
        expect(store.getState().selection).toEqual(['page']);
    });
});
