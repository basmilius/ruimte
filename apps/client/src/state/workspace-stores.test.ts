import { describe, expect, test } from 'bun:test';
import { createStore } from 'zustand';
import { createCanvasStore, defaultCanvasStore, focusedCanvas } from './canvas';
import { createEditorRegistry } from './editors';
import { useDocument } from './document';
import { resolveEditor, storeHook } from './workspace-stores';

describe('which editor a cell resolves to', () => {
    test('the cell it was asked about, even while another cell has the focus', () => {
        const registry = createEditorRegistry(createCanvasStore);
        registry.of('left');
        registry.of('right');
        registry.focus('right');

        expect(resolveEditor(registry, 'left')).toBe(registry.peek('left')!);
        expect(resolveEditor(registry, 'right')).toBe(registry.peek('right')!);
    });

    /* The bug this answers: a component drawn in one cell wrote into the cell that had the focus,
       so two drawings side by side edited the same elements. Naming the cell is what settles it. */
    test('two cells resolve to two editors, and neither is the other', () => {
        const registry = createEditorRegistry(createCanvasStore);
        registry.of('left');
        registry.of('right');
        registry.focus('right');
        resolveEditor(registry, 'left').getState().addText({ x: 0, y: 0 });

        expect(Object.keys(resolveEditor(registry, 'left').getState().texts)).toHaveLength(1);
        expect(Object.keys(resolveEditor(registry, 'right').getState().texts)).toHaveLength(0);
    });

    test('no cell means the one with the focus', () => {
        const registry = createEditorRegistry(createCanvasStore);
        registry.of('left');
        registry.of('right');
        registry.focus('left');
        expect(resolveEditor(registry, null)).toBe(registry.peek('left')!);

        registry.focus('right');
        expect(resolveEditor(registry, null)).toBe(registry.peek('right')!);
    });

    test('a view with no editor of this kind reads the blank one, and so does a grid with no focus', () => {
        const registry = createEditorRegistry(createCanvasStore);
        registry.of('canvas');
        registry.focus('canvas');

        // A chat cell asking for a canvas: there is none, and the blank editor is what it reads.
        expect(resolveEditor(registry, 'chat')).toBe(registry.blank);
        registry.focus(null);
        expect(resolveEditor(registry, null)).toBe(registry.blank);
    });
});

describe('the hooks of the window', () => {
    test('with no view open the focused canvas is the blank editor the module made', () => {
        // Said out loud, because a project left open by another test would resolve to its editor instead.
        useDocument.getState().load(null, null);
        focusedCanvas().setState({ viewport: { w: 640, h: 480 } });
        expect(defaultCanvasStore.getState().viewport).toEqual({ w: 640, h: 480 });
    });

    test('a store hook reads, writes and listens to the store it was made over', () => {
        const store = createStore<{ count: number }>(() => ({ count: 0 }));
        const hook = storeHook(store);
        const seen: number[] = [];
        const off = hook.subscribe((state) => seen.push(state.count));
        hook.setState({ count: 1 });
        off();
        store.setState({ count: 2 });

        expect(hook.getState().count).toBe(2);
        expect(seen).toEqual([1]);
    });
});
