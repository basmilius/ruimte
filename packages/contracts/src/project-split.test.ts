import { describe, expect, test } from 'bun:test';
import { EMPTY_PRIVATE_FILE, PROJECT_VERSION, type ProjectCanvasView, type ProjectContent, type ProjectSharedFile, type ProjectView } from './project.ts';
import { canShareView, mergeFiles, privateFileOf, splitContent, viewShareRefusal } from './project-split.ts';

const canvas = (id: string, nodes: ProjectCanvasView['nodes'] = []): ProjectView => ({
    kind: 'canvas',
    id,
    name: id,
    nodes,
    texts: [],
    edges: [],
    layouts: []
});

const node = (id: string, extra: Record<string, unknown> = {}): ProjectCanvasView['nodes'][number] =>
    ({ id, kind: 'chat', title: id, x: 0, y: 0, w: 100, h: 100, ...extra }) as ProjectCanvasView['nodes'][number];

const chatView = (id: string, extra: Record<string, unknown> = {}): ProjectView => ({ kind: 'chat', id, name: id, node: extra });

const content = (views: ProjectView[]): ProjectContent => ({ name: 'repo', color: '#7c74ff', views });

const fallback = { name: 'repo', color: '#7c74ff' };

describe('splitContent', () => {
    test('a view nobody shared stays whole in the private file, and the shared one has no rev', () => {
        const split = splitContent(content([canvas('main'), canvas('release')]), ['release'], 7);
        expect(split.shared.views.map((view) => view.id)).toEqual(['release']);
        expect(split.private.views.map((view) => view.id)).toEqual(['main']);
        expect(split.private.rev).toBe(7);
        expect(split.private.order).toEqual(['main', 'release']);
        expect('rev' in split.shared).toBe(false);
        expect(split.shared.version).toBe(PROJECT_VERSION);
    });

    test('the session, the mode and the worktree of a shared node wait in the overlay', () => {
        const held = node('n1', { resume: 'sess-1', runtimeMode: 'auto-accept-edits', worktree: { path: '/home/bas/wt', branch: 'feat' } });
        const split = splitContent(content([canvas('main', [held, node('n2')])]), ['main'], 1);
        const shared = split.shared.views[0] as ProjectCanvasView;
        expect(shared.nodes[0]).toEqual(node('n1'));
        expect(split.private.overlay.n1).toEqual({ resume: 'sess-1', runtimeMode: 'auto-accept-edits', worktree: { path: '/home/bas/wt', branch: 'feat' } });
        // A node with nothing of its own leaves nothing behind.
        expect(split.private.overlay.n2).toBeUndefined();
    });

    test('a folder inside the project travels and one outside it does not', () => {
        const split = splitContent(content([canvas('main', [node('in', { cwd: './apps/server' }), node('out', { cwd: '/etc' })])]), ['main'], 1);
        const shared = split.shared.views[0] as ProjectCanvasView;
        expect(shared.nodes[0]!.cwd).toBe('./apps/server');
        expect(shared.nodes[1]!.cwd).toBeUndefined();
        expect(split.private.overlay.out).toEqual({ cwd: '/etc' });
        expect(split.private.overlay.in).toBeUndefined();
    });

    test('a chat view holds its session under its own id, since a view id and a node id are one namespace', () => {
        const split = splitContent(content([chatView('c1', { provider: 'claude', resume: 'sess-9' })]), ['c1'], 1);
        expect(split.shared.views[0]).toEqual(chatView('c1', { provider: 'claude' }));
        expect(split.private.overlay.c1).toEqual({ resume: 'sess-9' });
    });

    test('a file view pointing off the project folder is kept back however it was asked for', () => {
        const outside: ProjectView = { kind: 'file', id: 'f1', name: 'notes', path: '/home/bas/notes.md' };
        const inside: ProjectView = { kind: 'file', id: 'f2', name: 'readme', path: 'README.md' };
        expect(viewShareRefusal(outside)).toBe('path-outside-project');
        expect(canShareView(inside)).toBe(true);
        const split = splitContent(content([outside, inside]), ['f1', 'f2'], 1);
        expect(split.shared.views.map((view) => view.id)).toEqual(['f2']);
        expect(split.private.views.map((view) => view.id)).toEqual(['f1']);
    });

    test('an id in the list that names no view of this project is ignored', () => {
        const split = splitContent(content([canvas('main')]), ['main', 'ghost'], 1);
        expect(split.shared.views.map((view) => view.id)).toEqual(['main']);
    });
});

describe('mergeFiles', () => {
    test('what the split took apart comes back the same, overlay and order included', () => {
        const before = content([canvas('main', [node('n1', { resume: 'sess-1', cwd: '/etc' })]), chatView('c1', { resume: 'sess-2' }), canvas('own')]);
        const split = splitContent(before, ['main', 'c1'], 3);
        expect(mergeFiles(split.shared, split.private, fallback)).toEqual({ content: before, shared: ['main', 'c1'] });
    });

    test('a shared view the private file never heard of falls in behind the one before it', () => {
        const shared: ProjectSharedFile = { version: PROJECT_VERSION, name: 'repo', color: '#7c74ff', views: [canvas('a'), canvas('new'), canvas('b')] };
        const file = { ...EMPTY_PRIVATE_FILE, views: [canvas('mine')], order: ['a', 'mine', 'b'] };
        expect(mergeFiles(shared, file, fallback).content.views.map((view) => view.id)).toEqual(['a', 'new', 'mine', 'b']);
    });

    test('without a shared file the project falls back on the name and color the daemon knows', () => {
        const merged = mergeFiles(null, privateFileOf([canvas('main')], 4), { name: 'from registry', color: '#000' });
        expect(merged.content.name).toBe('from registry');
        expect(merged.shared).toEqual([]);
        expect(merged.content.views.map((view) => view.id)).toEqual(['main']);
    });

    test('a view of an unknown kind travels whole, in whichever file it was in', () => {
        const unknown = { kind: 'unknown' as const, id: 'timeline', name: 'Flow', raw: { kind: 'timeline', id: 'timeline', name: 'Flow' } };
        const split = splitContent(content([unknown, canvas('main')]), ['timeline'], 1);
        expect(split.shared.views[0]).toEqual(unknown);
        expect(mergeFiles(split.shared, split.private, fallback).content.views[0]).toEqual(unknown);
    });
});
