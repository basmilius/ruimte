import { describe, expect, test } from 'bun:test';
import { answersToWire, toggleChoice } from './answers';

describe('toggleChoice', () => {
    test('adds a choice that is not picked yet', () => {
        expect(toggleChoice([], 'Blue')).toEqual(['Blue']);
        expect(toggleChoice(['Blue'], 'Green')).toEqual(['Blue', 'Green']);
    });

    test('removes a choice that is picked', () => {
        expect(toggleChoice(['Blue', 'Green'], 'Blue')).toEqual(['Green']);
    });

    // Regression test. A label holding the separator used to stop matching itself once picked.
    test('a label that holds the separator toggles like any other', () => {
        const label = 'Toolbar once, Dock per cell';
        const picked = toggleChoice([], label);
        expect(picked).toEqual([label]);
        expect(picked.includes(label)).toBe(true);
        expect(toggleChoice(picked, label)).toEqual([]);
    });
});

describe('answersToWire', () => {
    test('joins the choices of a question into one line', () => {
        expect(answersToWire({ '0': ['Blue'], '1': ['Green', 'Red'] })).toEqual({ '0': 'Blue', '1': 'Green, Red' });
    });

    test('an unanswered question travels as an empty string', () => {
        expect(answersToWire({ '0': [] })).toEqual({ '0': '' });
    });
});
