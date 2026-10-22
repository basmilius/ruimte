import { describe, expect, test } from 'bun:test';
import { NODE_ACCENT_NAMES, nodeColorOf, nodeColorPatch, notePaperOf } from './node-accents.ts';

describe('notePaperOf', () => {
    test('reads the four old papers as the accent of their name, and gray as the neutral paper', () => {
        expect(['yellow', 'green', 'blue', 'pink', 'gray'].map((color) => notePaperOf({ color }))).toEqual(['yellow', 'green', 'blue', 'pink', 'neutral']);
    });

    test('takes every accent as the paper of a note without an old paper', () => {
        for (const accent of NODE_ACCENT_NAMES) {
            expect(notePaperOf({ accent })).toBe(accent);
        }
    });

    test('keeps the old paper over an accent, so a project looks as it did', () => {
        expect(notePaperOf({ color: 'green', accent: 'red' })).toBe('green');
        expect(notePaperOf({ color: 'gray', accent: 'teal' })).toBe('neutral');
    });

    test('counts no name it does not know, and gives the default paper without either', () => {
        expect(notePaperOf({ color: 'chartreuse', accent: 'teal' })).toBe('teal');
        expect(notePaperOf({ color: 'chartreuse', accent: '#ff0000' })).toBeNull();
        expect(notePaperOf({ color: 'constructor' })).toBeNull();
        expect(notePaperOf({})).toBeNull();
    });
});

describe('nodeColorOf', () => {
    test('is the paper of a note and the accent of every other node', () => {
        expect(nodeColorOf({ kind: 'note', color: 'blue', accent: 'red' })).toBe('blue');
        expect(nodeColorOf({ kind: 'terminal', color: 'blue', accent: 'red' })).toBe('red');
        expect(nodeColorOf({ kind: 'chat', accent: 'nope' })).toBeNull();
    });
});

describe('nodeColorPatch', () => {
    test('takes the old paper off a note with every pick, none too', () => {
        expect(nodeColorPatch({ kind: 'note' }, 'teal')).toEqual({ accent: 'teal', color: undefined });
        expect(nodeColorPatch({ kind: 'note' }, null)).toEqual({ accent: undefined, color: undefined });
    });

    test('leaves a color key alone on any node that is not a note', () => {
        expect(nodeColorPatch({ kind: 'terminal' }, 'teal')).toEqual({ accent: 'teal' });
        expect('color' in nodeColorPatch({ kind: 'terminal' }, null)).toBe(false);
    });
});
