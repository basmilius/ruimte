import { describe, expect, test } from 'bun:test';
import type { FlowDocument } from '@ruimte/contracts';
import { createFlowStore } from '@/state/flow';

const loaded = (document: Partial<FlowDocument> = {}) => {
    const store = createFlowStore();
    store.getState().load('view-a', { version: 1, rev: 3, cards: {}, links: [], ...document }, null);
    return store;
};

describe('the worksheet a person draws', () => {
    test('a new card starts on the defaults of its catalog entry and is the one that is picked', () => {
        const store = loaded();
        const id = store.getState().addCard('trigger', 'time.at', { x: 33, y: 71 });
        expect(store.getState().content.cards[id]?.args).toEqual({ every: 'day', at: '08:00', minutes: 15 });
        expect(store.getState().selection).toEqual([id]);
        // It lands on the grid, so a worksheet built by pressing the same button twice lines up.
        expect(store.getState().content.cards[id]?.x % 8).toBe(0);
    });

    test('a line only goes out of a port the card has, and never twice', () => {
        const store = loaded();
        const trigger = store.getState().addCard('trigger', 'files.changed', { x: 0, y: 0 });
        const shout = store.getState().addCard('action', 'person.notify', { x: 400, y: 0 });
        store.getState().link(trigger, 'done', shout);
        store.getState().link(trigger, 'done', shout);
        store.getState().link(trigger, 'true', shout);
        expect(store.getState().content.links).toEqual([{ from: trigger, fromPort: 'done', to: shout }]);
    });

    test('a card that goes takes the lines on it along, since half a line is not a line', () => {
        const store = loaded();
        const trigger = store.getState().addCard('trigger', 'files.changed', { x: 0, y: 0 });
        const shout = store.getState().addCard('action', 'person.notify', { x: 400, y: 0 });
        store.getState().link(trigger, 'done', shout);
        store.getState().removeCards([shout]);
        expect(store.getState().content.links).toEqual([]);
        expect(store.getState().selection).toEqual([]);
    });

    test('undo steps back over a whole change, and redo forward again', () => {
        const store = loaded();
        const id = store.getState().addCard('condition', 'text.contains', { x: 0, y: 0 });
        store.getState().setInverted(id, true);
        expect(store.getState().content.cards[id]?.inverted).toBe(true);
        store.getState().undo();
        expect(store.getState().content.cards[id]?.inverted).toBeUndefined();
        store.getState().redo();
        expect(store.getState().content.cards[id]?.inverted).toBe(true);
    });

    test('what is on disk now replaces what was there, and the steps back from before are gone', () => {
        const store = loaded();
        store.getState().addCard('note', undefined, { x: 0, y: 0 });
        store.getState().applyDocument({ version: 1, rev: 9, cards: {}, links: [] });
        expect(store.getState().rev).toBe(9);
        expect(store.getState().past).toEqual([]);
        expect(store.getState().dirty).toBe(false);
    });
});
