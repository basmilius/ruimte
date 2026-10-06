import { describe, expect, test } from 'bun:test';
import { NavigationHistory, type Place } from '@adecore/editor-react';

const place = (uri: string, line: number, character = 0): Place => ({ uri, position: { line, character } });
const a = 'file:///work/a.ts';
const b = 'file:///work/b.ts';

describe('the history of jumps', () => {
    test('walks back and forward over places, current one included', () => {
        const history = new NavigationHistory();
        history.record(place(a, 1));
        history.record(place(b, 7));
        expect(history.back(place(a, 40))).toEqual(place(b, 7));
        expect(history.back(place(b, 7))).toEqual(place(a, 1));
        expect(history.back(place(a, 1))).toBeNull();
        expect(history.forward(place(a, 1))).toEqual(place(b, 7));
        expect(history.forward(place(b, 7))).toEqual(place(a, 40));
        expect(history.forward(place(a, 40))).toBeNull();
    });

    test('a new jump forgets what Forward knew', () => {
        const history = new NavigationHistory();
        history.record(place(a, 1));
        history.back(place(a, 9));
        history.record(place(a, 2));
        expect(history.canGoForward(place(a, 2))).toBe(false);
    });

    test('takes two places on one line for one, and never stops on the line the caret is on', () => {
        const history = new NavigationHistory();
        history.record(place(a, 3, 1));
        history.record(place(a, 3, 8));
        history.record(place(b, 2));
        expect(history.recent(place(b, 2))).toEqual([place(a, 3, 8)]);
        expect(history.back(place(b, 2))).toEqual(place(a, 3, 8));
        expect(history.back(place(a, 3, 8))).toBeNull();
    });

    test('lists the places back first, latest first, then those forward', () => {
        const history = new NavigationHistory();
        history.record(place(a, 1));
        history.record(place(a, 2));
        history.record(place(a, 3));
        history.back(place(a, 4));
        history.back(place(a, 3));
        expect(history.recent(place(a, 2)).map((entry) => entry.position.line)).toEqual([1, 3, 4]);
    });

    test('keeps the last hundred places', () => {
        const history = new NavigationHistory();
        for (let line = 0; line < 150; line++) {
            history.record(place(a, line));
        }
        expect(history.recent(place(b, 0))).toHaveLength(100);
        expect(history.recent(place(b, 0))[99]!.position.line).toBe(50);
    });
});
