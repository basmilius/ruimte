import { describe, expect, test } from 'bun:test';
import { DEFAULT_WEBGL_CONTEXTS, WebglSlots } from './webgl-slots.ts';

const requestAll = (slots: WebglSlots, ids: string[]): void => {
    for (const id of ids) {
        slots.request(id);
    }
};

describe('WebglSlots', () => {
    test('everyone under the cap gets a context', () => {
        const slots = new WebglSlots(3);
        expect(slots.request('a')).toEqual({ granted: ['a'], revoked: [] });
        expect(slots.request('b')).toEqual({ granted: ['b'], revoked: [] });
        expect(slots.holders().sort()).toEqual(['a', 'b']);
    });

    test('the terminal that asks last evicts the lowest ranked holder', () => {
        const slots = new WebglSlots(2);
        requestAll(slots, ['a', 'b']);
        expect(slots.request('c')).toEqual({ granted: ['c'], revoked: ['a'] });
        expect(slots.holders().sort()).toEqual(['b', 'c']);
        expect(slots.waiting()).toEqual(['a']);
    });

    test('a released holder hands its context to the highest ranked waiter', () => {
        const slots = new WebglSlots(2);
        requestAll(slots, ['a', 'b', 'c', 'd']);
        expect(slots.holders().sort()).toEqual(['c', 'd']);
        // b outranks a: it asked later.
        expect(slots.release('d')).toEqual({ granted: ['b'], revoked: [] });
        expect(slots.holders().sort()).toEqual(['b', 'c']);
    });

    test('releasing a terminal that never asked changes nothing', () => {
        const slots = new WebglSlots(2);
        requestAll(slots, ['a']);
        expect(slots.release('gone')).toEqual({ granted: [], revoked: [] });
        expect(slots.holders()).toEqual(['a']);
    });

    test('a context loss re-queues instead of disposing forever, and a focus brings it back', () => {
        const slots = new WebglSlots(2);
        requestAll(slots, ['a', 'b', 'c']);
        expect(slots.holders().sort()).toEqual(['b', 'c']);
        // The freed slot goes to a; b itself waits for a focus, so it does not take its own slot back.
        expect(slots.lost('b')).toEqual({ granted: ['a'], revoked: [] });
        expect(slots.holders().sort()).toEqual(['a', 'c']);
        expect(slots.focus('b')).toEqual({ granted: ['b'], revoked: ['a'] });
        expect(slots.holders().sort()).toEqual(['b', 'c']);
    });

    test('output on a terminal that lost its context does not ask for a new one', () => {
        const slots = new WebglSlots(1);
        requestAll(slots, ['a']);
        slots.lost('a');
        expect(slots.touch('a')).toEqual({ granted: [], revoked: [] });
        expect(slots.holders()).toEqual([]);
    });

    test('the focused terminal outranks every other, whatever they wrote', () => {
        const slots = new WebglSlots(2);
        requestAll(slots, ['a', 'b', 'c']);
        expect(slots.focus('a')).toEqual({ granted: ['a'], revoked: ['b'] });
        slots.touch('b');
        slots.touch('c');
        expect(slots.holds('a')).toBe(true);
        expect(slots.holders()).toEqual(['a', 'c']);
    });

    test('a blur leaves the ranking to the last write', () => {
        const slots = new WebglSlots(1);
        requestAll(slots, ['a', 'b']);
        slots.focus('a');
        expect(slots.holders()).toEqual(['a']);
        slots.touch('b');
        expect(slots.blur('a')).toEqual({ granted: ['b'], revoked: ['a'] });
    });

    test('output promotes a waiter over an idle holder', () => {
        const slots = new WebglSlots(2);
        requestAll(slots, ['a', 'b', 'c']);
        expect(slots.holders().sort()).toEqual(['b', 'c']);
        expect(slots.touch('a')).toEqual({ granted: ['a'], revoked: ['b'] });
    });

    test('output on a holder decides nothing', () => {
        const slots = new WebglSlots(2);
        requestAll(slots, ['a', 'b']);
        expect(slots.touch('a')).toEqual({ granted: [], revoked: [] });
    });

    test('a smaller cap evicts from the bottom, a larger one fills from the top', () => {
        const slots = new WebglSlots(3);
        requestAll(slots, ['a', 'b', 'c']);
        expect(slots.setCap(1)).toEqual({ granted: [], revoked: ['a', 'b'] });
        expect(slots.holders()).toEqual(['c']);
        expect(slots.setCap(3)).toEqual({ granted: ['a', 'b'], revoked: [] });
    });

    test('the cap is at least one context', () => {
        const slots = new WebglSlots(0);
        expect(slots.request('a')).toEqual({ granted: ['a'], revoked: [] });
    });

    test('the default cap stays under what a browser keeps alive', () => {
        expect(DEFAULT_WEBGL_CONTEXTS).toBe(10);
        const slots = new WebglSlots();
        requestAll(
            slots,
            Array.from({ length: 20 }, (_, index) => `n${index}`)
        );
        expect(slots.holders()).toHaveLength(DEFAULT_WEBGL_CONTEXTS);
    });
});
