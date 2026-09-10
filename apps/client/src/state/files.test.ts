import { describe, expect, test } from 'bun:test';
import { closeTab, openTab, pinTab, type FileTab, type TabState } from './files.ts';

const tab = (path: string, pinned = false): FileTab => ({ path, pinned, dirty: false });

const state = (paths: string[], active: string | null): TabState => ({ tabs: paths.map((path) => tab(path)), active });

describe('openTab', () => {
    test('activates a file that is already open instead of opening it twice', () => {
        const next = openTab(state(['a', 'b'], 'a'), 'b', 5);
        expect(next.tabs).toHaveLength(2);
        expect(next.active).toBe('b');
    });

    test('past the limit the oldest unpinned tab makes room', () => {
        const next = openTab(state(['a', 'b', 'c'], 'a'), 'd', 3);
        expect(next.tabs.map((entry) => entry.path)).toEqual(['b', 'c', 'd']);
        expect(next.active).toBe('d');
    });

    test('a pinned tab stays and the next unpinned one goes', () => {
        const pinned: TabState = { tabs: [tab('a', true), tab('b'), tab('c')], active: 'a' };
        expect(openTab(pinned, 'd', 3).tabs.map((entry) => entry.path)).toEqual(['a', 'c', 'd']);
    });

    test('nothing but pinned tabs means the limit gives way, never a pin', () => {
        const pinned: TabState = { tabs: [tab('a', true), tab('b', true)], active: 'a' };
        expect(openTab(pinned, 'c', 2).tabs.map((entry) => entry.path)).toEqual(['a', 'b', 'c']);
    });
});

describe('closeTab', () => {
    test('the neighbor to the right takes over, then the one before it', () => {
        expect(closeTab(state(['a', 'b', 'c'], 'b'), 'b').active).toBe('c');
        expect(closeTab(state(['a', 'b', 'c'], 'c'), 'c').active).toBe('b');
        expect(closeTab(state(['a'], 'a'), 'a').active).toBeNull();
    });

    test('closing another tab leaves the active one where it is', () => {
        const next = closeTab(state(['a', 'b', 'c'], 'a'), 'c');
        expect(next.active).toBe('a');
        expect(next.tabs).toHaveLength(2);
    });

    test('a path that is not open changes nothing', () => {
        const before = state(['a'], 'a');
        expect(closeTab(before, 'z')).toBe(before);
    });
});

describe('pinTab', () => {
    test('pins and unpins the one tab it names', () => {
        const next = pinTab(state(['a', 'b'], 'a'), 'a', true);
        expect(next.tabs.map((entry) => entry.pinned)).toEqual([true, false]);
        expect(pinTab(next, 'a', false).tabs[0]!.pinned).toBe(false);
    });
});
