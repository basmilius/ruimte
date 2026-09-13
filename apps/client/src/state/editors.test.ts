import { describe, expect, test } from 'bun:test';
import { createStore, type StoreApi } from 'zustand';
import { createEditorRegistry } from './editors';

interface Counter {
    value: number;
    bump(): void;
}

const counter = (): StoreApi<Counter> => createStore<Counter>((set) => ({ value: 0, bump: () => set((state) => ({ value: state.value + 1 })) }));

const registry = (): ReturnType<typeof createEditorRegistry<Counter>> => createEditorRegistry(counter);

describe('an editor per view', () => {
    test('the same view is the same editor, a different view is a different one', () => {
        const editors = registry();
        expect(editors.of('a')).toBe(editors.of('a'));
        expect(editors.of('a')).not.toBe(editors.of('b'));
    });

    test('a view nobody opened has no editor, and the blank one stands in for it', () => {
        const editors = registry();
        expect(editors.peek('a')).toBeNull();
        expect(editors.blank).toBe(editors.blank);
        editors.of('a');
        expect(editors.peek('a')).not.toBeNull();
    });

    test('two editors of the same registry hold their own state', () => {
        const editors = registry();
        editors.of('a').getState().bump();
        expect(editors.of('a').getState().value).toBe(1);
        expect(editors.of('b').getState().value).toBe(0);
    });

    test('live names every editor in the order they opened', () => {
        const editors = registry();
        editors.of('a');
        editors.of('b');
        expect(editors.live().map(([viewId]) => viewId)).toEqual(['a', 'b']);
    });

    test('keeping a list releases everything outside it', () => {
        const editors = registry();
        editors.of('a');
        editors.of('b');
        editors.keep(['b']);
        expect(editors.live().map(([viewId]) => viewId)).toEqual(['b']);
        expect(editors.peek('a')).toBeNull();
    });

    test('a released view opens again as an empty editor, not as the one it had', () => {
        const editors = registry();
        editors.of('a').getState().bump();
        editors.release('a');
        expect(editors.of('a').getState().value).toBe(0);
    });
});

describe('what a reader subscribes to', () => {
    test('a change in any editor arrives named by the view it happened in', () => {
        const editors = registry();
        const seen: Array<[string, number]> = [];
        const off = editors.subscribe((viewId, state) => seen.push([viewId, state.value]));
        editors.of('a').getState().bump();
        editors.of('b').getState().bump();
        off();
        editors.of('a').getState().bump();

        expect(seen).toEqual([
            ['a', 1],
            ['b', 1]
        ]);
    });

    test('an editor that was released stops reaching the reader', () => {
        const editors = registry();
        const seen: string[] = [];
        editors.subscribe((viewId) => seen.push(viewId));
        const store = editors.of('a');
        editors.release('a');
        store.getState().bump();

        expect(seen).toEqual([]);
    });

    test('the shape is every open, every release and every move of the focus', () => {
        const editors = registry();
        let changes = 0;
        const off = editors.subscribeShape(() => {
            changes += 1;
        });
        editors.of('a');
        editors.focus('a');
        // The same focus twice is not a change; a reader would rerender for nothing.
        editors.focus('a');
        editors.of('a');
        editors.release('a');
        off();
        editors.focus('b');

        expect(changes).toBe(3);
    });

    test('what is inside an editor is not its shape', () => {
        const editors = registry();
        editors.of('a');
        let changes = 0;
        editors.subscribeShape(() => {
            changes += 1;
        });
        editors.of('a').getState().bump();

        expect(changes).toBe(0);
    });
});

describe('the focus', () => {
    test('nothing has it until the document says so', () => {
        const editors = registry();
        expect(editors.focused()).toBeNull();
        editors.focus('a');
        expect(editors.focused()).toBe('a');
    });

    test('a view can hold the focus before its editor exists, which is what a chat view is', () => {
        const editors = registry();
        editors.focus('chat-1');
        expect(editors.focused()).toBe('chat-1');
        expect(editors.peek('chat-1')).toBeNull();
    });
});
