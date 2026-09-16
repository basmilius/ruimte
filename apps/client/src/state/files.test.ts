import { beforeEach, describe, expect, test } from 'bun:test';
import { closeTab, openTab, pinTab, RECENT_FILES_LIMIT, rememberClosed, useFiles, type FileTab, type TabState } from './files.ts';
import { useUi } from './ui.ts';

const tab = (path: string, pinned = false): FileTab => ({ key: path, path, pinned, dirty: false });

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

describe('a diff tab', () => {
    test('sits next to the file it belongs to instead of replacing it', () => {
        const view = { kind: 'diff', cwd: '/repo', scope: 'worktree', staged: false } as const;
        const next = openTab(state(['a'], 'a'), 'a', 5, view);
        expect(next.tabs.map((entry) => entry.key)).toEqual(['a', 'diff:a']);
        expect(next.active).toBe('diff:a');
    });

    test('another change opens in the diff tab nobody pinned instead of a tab of its own', () => {
        const first = openTab(state(['a'], 'a'), 'a', 5, { kind: 'diff', cwd: '/repo', scope: 'worktree', staged: false });
        const second = openTab(first, 'b', 5, { kind: 'diff', cwd: '/repo', scope: 'worktree', staged: true });
        expect(second.tabs.map((entry) => entry.key)).toEqual(['a', 'diff:b']);
        expect(second.active).toBe('diff:b');
    });

    test('a pinned diff stays where it is and the next change opens beside it', () => {
        const first = openTab(state([], null), 'a', 5, { kind: 'diff', cwd: '/repo', scope: 'worktree', staged: false });
        const pinned = pinTab(first, 'diff:a', true);
        const second = openTab(pinned, 'b', 5, { kind: 'diff', cwd: '/repo', scope: 'worktree', staged: false });
        expect(second.tabs.map((entry) => entry.key)).toEqual(['diff:a', 'diff:b']);
        // And the one that is not pinned is the one the change after that takes over again.
        expect(openTab(second, 'c', 5, { kind: 'diff', cwd: '/repo', scope: 'worktree', staged: false }).tabs.map((entry) => entry.key)).toEqual([
            'diff:a',
            'diff:c'
        ]);
    });

    test('opening it again in another scope moves the tab it already has', () => {
        const first = openTab(state([], null), 'a', 5, { kind: 'diff', cwd: '/repo', scope: 'worktree', staged: false });
        const second = openTab(first, 'a', 5, { kind: 'diff', cwd: '/repo', scope: 'base', staged: false });
        expect(second.tabs).toHaveLength(1);
        expect(second.tabs[0]!.view?.scope).toBe('base');
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

describe('the store and the preview panel', () => {
    beforeEach(() => {
        // Without a project id, the tabs stay out of storage the test environment does not have.
        useFiles.setState({ projectId: null, tabs: [], active: null, focusRequest: 0 });
        useUi.setState({ preview: { open: false } });
    });

    test('opening a file brings the preview up', () => {
        useFiles.getState().open('a', 5);
        expect(useUi.getState().preview.open).toBe(true);
    });

    test('a file opened by hand asks the preview for the keyboard, a restored project does not', () => {
        useFiles.getState().open('a', 5);
        useFiles.getState().open('b', 5);
        expect(useFiles.getState().focusRequest).toBe(2);
        useFiles.getState().load(null, { tabs: [], active: null, expandedDirs: [] });
        expect(useFiles.getState().focusRequest).toBe(2);
    });

    test('the last tab that closes takes the preview with it', () => {
        useFiles.getState().open('a', 5);
        useFiles.getState().open('b', 5);
        useFiles.getState().close('a');
        expect(useUi.getState().preview.open).toBe(true);
        useFiles.getState().close('b');
        expect(useUi.getState().preview.open).toBe(false);
    });
});

describe('pinTab', () => {
    test('pins and unpins the one tab it names', () => {
        const next = pinTab(state(['a', 'b'], 'a'), 'a', true);
        expect(next.tabs.map((entry) => entry.pinned)).toEqual([true, false]);
        expect(pinTab(next, 'a', false).tabs[0]!.pinned).toBe(false);
    });
});

describe('the files closed a moment ago', () => {
    const closed = (path: string, view?: FileTab['view']): FileTab => ({ key: path, path, ...(view ? { view } : {}), pinned: false, dirty: false });

    test('newest first, each file once, and only as many as the empty preview offers', () => {
        let recent: string[] = [];
        for (const path of ['/a', '/b', '/c', '/a', '/d', '/e', '/f']) {
            recent = rememberClosed(recent, closed(path));
        }
        expect(recent).toEqual(['/f', '/e', '/d', '/a', '/c']);
        expect(recent).toHaveLength(RECENT_FILES_LIMIT);
    });

    test('a diff is not a file to go back to', () => {
        expect(rememberClosed(['/a'], closed('/b', { kind: 'diff', cwd: '/', scope: 'worktree', staged: false }))).toEqual(['/a']);
        expect(rememberClosed(['/a'], undefined)).toEqual(['/a']);
    });
});
