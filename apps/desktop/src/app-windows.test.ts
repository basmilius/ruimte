import { describe, expect, test } from 'bun:test';
import { auxWindowKey, splitAuxWindowKey } from '@ruimte/desktop-bridge';
import { auxIdsOf, isWindowKey, isWindowMessage, isWindowState, isWindowView, tabStripOf, totalActivity, windowPointOf, windowUrl } from './app-windows';

describe('windowUrl', () => {
    const base = 'http://127.0.0.1:4210/';

    test('carries the key whole, colon included', () => {
        for (const first of [false, true]) {
            expect(new URL(windowUrl(base, 'local:p1', first)).searchParams.get('project')).toBe('local:p1');
        }
    });

    test('opens a window without a key on the start screen', () => {
        expect(windowUrl(base, null, false)).toBe('http://127.0.0.1:4210/?start=1');
    });

    test('leaves the first window of a start without a session to what the page remembers', () => {
        expect(windowUrl(base, null, true)).toBe(base);
    });

    test('carries the view a project window shows first, and no view without a project', () => {
        expect(new URL(windowUrl(base, 'local:p1', false, 'chat-1')).searchParams.get('view')).toBe('chat-1');
        expect(windowUrl(base, null, false, 'chat-1')).toBe('http://127.0.0.1:4210/?start=1');
    });

    test('marks a project window back from the last session as dormant, and never a window without a project', () => {
        expect(new URL(windowUrl(base, 'local:p1', false, null, null, true)).searchParams.get('dormant')).toBe('1');
        expect(new URL(windowUrl(base, 'local:p1', false)).searchParams.has('dormant')).toBe(false);
        expect(windowUrl(base, null, false, null, null, true)).toBe('http://127.0.0.1:4210/?start=1');
    });

    test('carries what the page kept of itself, with a project and without one', () => {
        expect(new URL(windowUrl(base, 'local:p1', false, null, '["local:p1"]')).searchParams.get('state')).toBe('["local:p1"]');
        expect(new URL(windowUrl(base, null, true, null, 'x')).searchParams.has('start')).toBe(false);
        expect(new URL(windowUrl(base, null, false, null, 'x')).searchParams.get('start')).toBe('1');
    });
});

describe('isWindowState', () => {
    test('takes null or a string of a bounded size', () => {
        expect(isWindowState(null)).toBe(true);
        expect(isWindowState('[]')).toBe(true);
        expect(isWindowState('x'.repeat(8193))).toBe(false);
        expect(isWindowState(3)).toBe(false);
    });
});

describe('tabStripOf', () => {
    test('takes a box with a size and nothing else', () => {
        expect(tabStripOf({ x: 80, y: 8, width: 600, height: 32 })).toEqual({ x: 80, y: 8, width: 600, height: 32 });
        expect(tabStripOf({ x: 80, y: 8, width: 0, height: 32 })).toBeNull();
        expect(tabStripOf(null)).toBeNull();
    });
});

describe('windowPointOf', () => {
    test('takes two finite numbers and nothing else', () => {
        expect(windowPointOf({ x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
        expect(windowPointOf({ x: 1 })).toBeUndefined();
        expect(windowPointOf({ x: Number.NaN, y: 2 })).toBeUndefined();
        expect(windowPointOf(null)).toBeUndefined();
    });
});

describe('isWindowView', () => {
    test('takes a non-empty string and nothing else', () => {
        expect(isWindowView('chat-1')).toBe(true);
        expect(isWindowView('')).toBe(false);
        expect(isWindowView(undefined)).toBe(false);
        expect(isWindowView('x'.repeat(257))).toBe(false);
    });
});

describe('isWindowKey', () => {
    test('takes a non-empty string and nothing else', () => {
        expect(isWindowKey('local:p1')).toBe(true);
        expect(isWindowKey('')).toBe(false);
        expect(isWindowKey(3)).toBe(false);
        expect(isWindowKey(null)).toBe(false);
        expect(isWindowKey('x'.repeat(513))).toBe(false);
    });
});

describe('totalActivity', () => {
    test('adds up the windows', () => {
        expect(
            totalActivity([
                { working: 2, attention: 1 },
                { working: 1, attention: 3 }
            ])
        ).toEqual({ working: 3, attention: 4 });
    });

    test('is nothing without windows', () => {
        expect(totalActivity([])).toEqual({ working: 0, attention: 0 });
    });

    test('counts nothing for a share that is not a count', () => {
        expect(
            totalActivity([
                { working: Number.NaN, attention: -2 },
                { working: 1, attention: 1 }
            ])
        ).toEqual({ working: 1, attention: 1 });
    });
});

describe('an auxiliary window', () => {
    const base = 'http://127.0.0.1:4210/';
    const key = auxWindowKey('local:p1', 'w1');

    test('loads the address of its project with its own id beside it', () => {
        const query = new URL(windowUrl(base, key, false)).searchParams;

        expect(query.get('project')).toBe('local:p1');
        expect(query.get('aux')).toBe('w1');
        expect(new URL(windowUrl(base, 'local:p1', false)).searchParams.has('aux')).toBe(false);
    });

    test('is listed by its id among the windows of its project, and of no other', () => {
        const keys = [null, 'local:p1', key, auxWindowKey('local:p1', 'w2'), auxWindowKey('local:p2', 'w3')];

        expect(auxIdsOf(keys, 'local:p1')).toEqual(['w1', 'w2']);
        expect(auxIdsOf(keys, 'local:p3')).toEqual([]);
    });

    test('has a key that names its project and its id, which the key of a project does not', () => {
        expect(splitAuxWindowKey(key)).toEqual({ project: 'local:p1', id: 'w1' });
        expect(splitAuxWindowKey('local:p1')).toBeNull();
    });
});

describe('isWindowMessage', () => {
    test('takes text up to its limit and nothing else', () => {
        expect(isWindowMessage('{"type":"ready"}')).toBe(true);
        expect(isWindowMessage('')).toBe(false);
        expect(isWindowMessage({ type: 'ready' })).toBe(false);
        expect(isWindowMessage('x'.repeat(262_145))).toBe(false);
    });
});
