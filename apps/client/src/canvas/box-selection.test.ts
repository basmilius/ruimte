import { describe, expect, test } from 'bun:test';
import { createCanvasStore } from '@/state/canvas';
import { boxScreenRect, boxWorldRect, startBoxSelection } from './box-selection';

describe('selection while the camera moves', () => {
    test('scrolling without moving the pointer keeps the start anchored to the canvas', () => {
        const store = createCanvasStore();
        store.setState({
            nodes: {
                a: { id: 'a', kind: 'note', title: 'A', x: 110, y: 110, w: 20, h: 20 },
                b: { id: 'b', kind: 'note', title: 'B', x: 210, y: 110, w: 20, h: 20 }
            }
        });
        const box = startBoxSelection(store.getState().camera, { x: 100, y: 100 }, [], false);
        box.current = { x: 150, y: 150 };
        store.getState().panBy(-100, 0);
        const camera = store.getState().camera;
        expect(boxScreenRect(box, camera)).toEqual({ x: 0, y: 100, w: 150, h: 50 });
        store.getState().selectInRect(boxWorldRect(box, camera));
        expect(store.getState().selection).toEqual(['a', 'b']);
    });

    test('zoom keeps the same world anchor and the other end under the pointer', () => {
        const box = startBoxSelection({ x: 40, y: 60, zoom: 2 }, { x: 240, y: 260 }, [], true);
        box.current = { x: 300, y: 350 };
        expect(boxWorldRect(box, { x: -20, y: 0, zoom: 0.5 })).toEqual({ x: 100, y: 100, w: 540, h: 600 });
        expect(boxScreenRect(box, { x: -20, y: 0, zoom: 0.5 })).toEqual({ x: 30, y: 50, w: 270, h: 300 });
    });
});
