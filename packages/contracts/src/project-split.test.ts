import { describe, expect, test } from 'bun:test';
import { EMPTY_PRIVATE_FILE, PROJECT_VERSION, type ProjectCanvasView, type ProjectContent, type ProjectSharedFile, type ProjectView } from './project.ts';
import { canShareView, mergeFiles, overlayOfLegacy, privateFileOf, splitContent, viewShareRefusal } from './project-split.ts';

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

const separator = (id: string): ProjectView => ({ kind: 'separator', id, name: id });

const subheader = (id: string): ProjectView => ({ kind: 'subheader', id, name: id });

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

    test('the session, the account, the mode and the worktree of a shared node wait in the overlay', () => {
        const held = node('n1', {
            resume: 'sess-1',
            account: 'claude_work',
            runtimeMode: 'auto-accept-edits',
            worktree: { path: '/home/bas/wt', branch: 'feat' }
        });
        const split = splitContent(content([canvas('main', [held, node('n2')])]), ['main'], 1);
        const shared = split.shared.views[0] as ProjectCanvasView;
        expect(shared.nodes[0]).toEqual(node('n1'));
        expect(split.private.overlay.n1).toEqual({
            resume: 'sess-1',
            account: 'claude_work',
            runtimeMode: 'auto-accept-edits',
            worktree: { path: '/home/bas/wt', branch: 'feat' }
        });
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

    test('a relative folder that climbs out of the project stays behind like an absolute one', () => {
        const split = splitContent(content([canvas('main', [node('up', { cwd: './a/../../etc' }), node('down', { cwd: 'a/../b' })])]), ['main'], 1);
        const shared = split.shared.views[0] as ProjectCanvasView;
        expect(shared.nodes[0]!.cwd).toBeUndefined();
        expect(split.private.overlay.up).toEqual({ cwd: './a/../../etc' });
        expect(shared.nodes[1]!.cwd).toBe('a/../b');
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

    test('a separator travels with the group under it and stays home when that whole stretch is private', () => {
        const views = [separator('s1'), canvas('a'), canvas('b'), separator('s2'), canvas('mine')];
        const split = splitContent(content(views), ['b'], 1);
        expect(split.shared.views.map((view) => view.id)).toEqual(['s1', 'b']);
        expect(split.private.views.map((view) => view.id)).toEqual(['a', 's2', 'mine']);

        // Nobody shares a separator itself, whatever the list says.
        expect(viewShareRefusal(separator('s1'))).toBe('follows-its-group');
        expect(splitContent(content(views), ['s1'], 1).shared.views).toEqual([]);
    });

    test('a subheader follows the same rule as a separator, and a line above a heading takes both along', () => {
        const views = [separator('s1'), subheader('h1'), canvas('a'), subheader('h2'), canvas('mine')];
        const split = splitContent(content(views), ['a'], 1);
        expect(split.shared.views.map((view) => view.id)).toEqual(['s1', 'h1', 'a']);
        expect(split.private.views.map((view) => view.id)).toEqual(['h2', 'mine']);

        expect(viewShareRefusal(subheader('h1'))).toBe('follows-its-group');
        expect(splitContent(content(views), ['h1'], 1).shared.views).toEqual([]);
    });

    test('only the last heading before a shared view travels, so a colleague never reads two in a row', () => {
        const views = [subheader('h1'), subheader('h2'), canvas('a')];
        const split = splitContent(content(views), ['a'], 1);
        expect(split.shared.views.map((view) => view.id)).toEqual(['h2', 'a']);
        expect(split.private.views.map((view) => view.id)).toEqual(['h1']);
    });

    test('a flag stays in the private file, and moving one leaves the shared file as it was', () => {
        const views = [canvas('main', [node('n1'), node('n2')]), canvas('mine')];
        const plain = splitContent(content(views), ['main'], 1);
        const flagged = splitContent({ ...content(views), flags: { main: 'red', n1: 'blue', mine: 'green' } }, ['main'], 1);
        expect(flagged.shared).toEqual(plain.shared);
        expect(JSON.stringify(flagged.shared)).not.toContain('red');
        expect(flagged.private.flags).toEqual({ main: 'red', n1: 'blue', mine: 'green' });
    });

    test('a flag whose view or node is gone goes with it, and no flags leave no key behind', () => {
        const split = splitContent({ ...content([canvas('main', [node('n1')])]), flags: { n1: 'red', gone: 'blue' } }, [], 1);
        expect(split.private.flags).toEqual({ n1: 'red' });
        expect('flags' in splitContent({ ...content([canvas('main')]), flags: { gone: 'blue' } }, [], 1).private).toBe(false);
        expect('flags' in splitContent(content([canvas('main')]), [], 1).private).toBe(false);
    });

    test('a color this version does not know is kept for the Ruimte that wrote it', () => {
        const split = splitContent({ ...content([canvas('main')]), flags: { main: 'ultraviolet' } }, [], 1);
        expect(split.private.flags).toEqual({ main: 'ultraviolet' });
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

    test('the flags come back over both files', () => {
        const before = { ...content([canvas('main', [node('n1')]), chatView('c1')]), flags: { main: 'red', n1: 'blue', c1: 'green' } };
        const split = splitContent(before, ['main'], 2);
        expect(mergeFiles(split.shared, split.private, fallback).content).toEqual(before);
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

    test('a shared file never hands on what only the overlay may carry', () => {
        const pushed = {
            resume: 'theirs',
            account: 'claude_theirs',
            runtimeMode: 'full-access',
            worktree: { path: '/tmp/wt', branch: 'x' },
            cwd: '/',
            path: '../../.ssh/id_ed25519'
        };
        const shared: ProjectSharedFile = {
            version: PROJECT_VERSION,
            name: 'repo',
            color: '#7c74ff',
            views: [canvas('main', [node('n1', pushed), node('n2', { cwd: './apps', path: 'README.md' })]), chatView('c1', { provider: 'claude', cwd: 'C:\\' })]
        };
        const merged = mergeFiles(shared, { ...EMPTY_PRIVATE_FILE, overlay: { n2: { resume: 'mine' } } }, fallback);
        const [main, chat] = merged.content.views as [ProjectCanvasView, ProjectView];
        expect(main.nodes[0]).toEqual(node('n1'));
        // What travels legitimately stays, and this person's own overlay is still laid over it.
        expect(main.nodes[1]).toEqual(node('n2', { cwd: './apps', path: 'README.md', resume: 'mine' }));
        expect(chat).toEqual(chatView('c1', { provider: 'claude' }));
    });

    test('a private view belongs to this person and keeps every field', () => {
        const own = canvas('own', [node('n1', { runtimeMode: 'auto-accept-edits', cwd: '/elsewhere' })]);
        expect(mergeFiles(null, privateFileOf([own], 1), fallback).content.views).toEqual([own]);
    });

    test('a view of an unknown kind travels whole, in whichever file it was in', () => {
        const unknown = { kind: 'unknown' as const, id: 'timeline', name: 'Flow', raw: { kind: 'timeline', id: 'timeline', name: 'Flow' } };
        const split = splitContent(content([unknown, canvas('main')]), ['timeline'], 1);
        expect(split.shared.views[0]).toEqual(unknown);
        expect(mergeFiles(split.shared, split.private, fallback).content.views[0]).toEqual(unknown);
    });
});

describe('overlayOfLegacy', () => {
    test('takes what an old single file held for this person, and only that', () => {
        const views = [canvas('main', [node('n1', { resume: 'sess-1', runtimeMode: 'auto-accept-edits', cwd: '/elsewhere' }), node('n2', { cwd: './apps' })])];
        expect(overlayOfLegacy(views)).toEqual({ n1: { resume: 'sess-1', runtimeMode: 'auto-accept-edits', cwd: '/elsewhere' } });
    });
});
