import { describe, expect, test } from 'bun:test';
import { isWindowKey, isWindowView, totalActivity, windowUrl } from './app-windows';

describe('windowUrl', () => {
    const base = 'http://127.0.0.1:4210/';

    test('carries the key whole, colon included', () => {
        expect(new URL(windowUrl(base, 'local:p1', false)).searchParams.get('project')).toBe('local:p1');
    });

    test('opens a window without a key on the start screen', () => {
        expect(windowUrl(base, null, false)).toBe('http://127.0.0.1:4210/?start=1');
    });

    test('leaves the first window of a start without a session to what the page remembers', () => {
        expect(windowUrl(base, null, true)).toBe(base);
    });

    test('a key wins over a first window', () => {
        expect(windowUrl(base, 'local:p1', true)).toContain('project=');
    });

    test('carries the view a project window shows first, and no view without a project', () => {
        expect(new URL(windowUrl(base, 'local:p1', false, 'chat-1')).searchParams.get('view')).toBe('chat-1');
        expect(windowUrl(base, null, false, 'chat-1')).toBe('http://127.0.0.1:4210/?start=1');
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
