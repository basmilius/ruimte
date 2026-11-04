import { expect, test } from 'bun:test';
import type { ProjectView, SplitLayout } from '@ruimte/contracts';
import { createStore } from 'zustand';
import type { Tab } from '@/state/files';
import { startFileReadPreparation } from './file-read-preparation';

function layout(...ids: string[]): SplitLayout {
    return { columns: [{ size: 1, cells: ids.map((viewId) => ({ size: 1, viewId })) }], focus: { column: 0, cell: 0 } };
}

function fixture(views: ProjectView[], shown: SplitLayout | null, tabs: Tab[] = []) {
    const project = createStore<{ current: { folder: string } | null; currentEndpointId: string | null; switching: boolean }>(() => ({
        current: { folder: '/work/app' },
        currentEndpointId: 'machine',
        switching: false
    }));
    const document = createStore<{ views: ProjectView[]; layout: SplitLayout | null; maximized: string | null }>(() => ({
        views,
        layout: shown,
        maximized: null
    }));
    const loose = createStore<{ tabs: Tab[] }>(() => ({ tabs }));
    const started: string[] = [];
    const active = new Set<string>();
    const stop = startFileReadPreparation(
        project,
        document,
        {
            prepare(endpointId, path) {
                const key = `${endpointId}:${path}`;
                started.push(key);
                active.add(key);
                return () => active.delete(key);
            }
        },
        loose
    );
    return { project, document, loose, started, active, stop };
}

const files: ProjectView[] = [
    { id: 'a', name: 'First', kind: 'file', path: 'src/a.ts' },
    { id: 'b', name: 'Second', kind: 'file', path: 'src/b.ts' },
    { id: 'c', name: 'Other folder', kind: 'file', path: 'docs/c.md' },
    { id: 'chat', name: 'Chat', kind: 'chat', node: {} }
];

test('only shown files prepare watches, sharing a folder and ignoring unchanged metadata', () => {
    const state = fixture(files, layout('a', 'b', 'chat'));
    expect(state.started).toEqual(['machine:/work/app/src']);
    state.project.setState({ current: { folder: '/work/app' } });
    state.document.setState({ views: files.map((view) => ({ ...view, name: 'Renamed' })) });
    expect(state.started).toHaveLength(1);
    expect([...state.active]).toEqual(['machine:/work/app/src']);
    state.stop();
    expect(state.active.size).toBe(0);
});

test('a switch waits for the new project and cleans up an unused preparation', () => {
    const state = fixture(files, layout('a'));
    state.project.setState({ switching: true });
    expect(state.active.size).toBe(0);
    state.project.setState({ current: { folder: '/next/project' }, currentEndpointId: 'other' });
    expect(state.started).toHaveLength(1);
    state.project.setState({ switching: false });
    expect([...state.active]).toEqual(['other:/next/project/src']);
    state.project.setState({ current: null, currentEndpointId: null });
    expect(state.active.size).toBe(0);
    state.stop();
});

test('maximization prepares just the visible cell and closing the layout releases it', () => {
    const state = fixture(files, layout('a', 'c'));
    expect(state.active.size).toBe(2);
    state.document.setState({ maximized: 'c' });
    expect([...state.active]).toEqual(['machine:/work/app/docs']);
    state.document.setState({ maximized: null, layout: null });
    expect(state.active.size).toBe(0);
    state.stop();
});

test('chat-only and closed layouts do not add filesystem activity', () => {
    const state = fixture(files, layout('chat'));
    expect(state.started).toHaveLength(0);
    state.document.setState({ layout: null });
    expect(state.started).toHaveLength(0);
    state.stop();
    state.document.setState({ layout: layout('a') });
    expect(state.started).toHaveLength(0);
});

test('a file on a Windows machine prepares the same parent path its reader watches', () => {
    const state = fixture(files, null);
    state.project.setState({ current: { folder: 'C:\\repo' } });
    state.document.setState({ views: [{ id: 'file', kind: 'file', name: 'File', path: 'src\\file.txt' }], layout: layout('file') });
    expect([...state.active]).toEqual(['machine:C:\\repo\\src']);
    state.stop();
});

test('a restored loose file follows its visible layout key, while diffs and database tabs add no watches', () => {
    const state = fixture([], layout('/work/app/src/a.ts', 'diff:/work/app/diff.ts', 'database:table'), [
        { key: '/work/app/src/a.ts', path: '/work/app/src/a.ts', pinned: true },
        { key: '/work/app/hidden/file.ts', path: '/work/app/hidden/file.ts', pinned: false },
        { key: 'diff:/work/app/diff.ts', path: '/work/app/diff.ts', pinned: true, view: { kind: 'diff', cwd: '/work/app', scope: 'base', staged: false } },
        { key: 'database:table', kind: 'table', connectionId: 'connection', schema: 'public', table: 'users', pinned: true }
    ]);
    expect([...state.active]).toEqual(['machine:/work/app/src']);
    state.document.setState({ layout: layout('/work/app/hidden/file.ts') });
    expect([...state.active]).toEqual(['machine:/work/app/hidden']);
    state.loose.setState({ tabs: [] });
    expect(state.active.size).toBe(0);
    state.stop();
});

test('the tab pool can arrive after the layout and closing it leaves no prepared watch', () => {
    const state = fixture([], layout('/work/app/file.ts'));
    expect(state.active.size).toBe(0);
    state.loose.setState({ tabs: [{ key: '/work/app/file.ts', path: '/work/app/file.ts', pinned: true }] });
    expect([...state.active]).toEqual(['machine:/work/app']);
    state.document.setState({ layout: null });
    expect(state.active.size).toBe(0);
    state.stop();
});
