import { describe, expect, test } from 'bun:test';
import {
    designFolderOf,
    designPlaces,
    EMPTY_PRIVATE_FILE,
    isDesignPath,
    PROJECT_VERSION,
    ProjectDocumentSchema,
    ProjectSharedFileSchema,
    storedViewsOf,
    viewChats,
    type ProjectCanvasView,
    type ProjectContent,
    type ProjectDesignView,
    type ProjectSharedFile,
    type ProjectView
} from './project.ts';
import { canShareView, mergeFiles, overlayOfLegacy, privateFieldsOf, privateFileOf, splitContent, viewShareRefusal } from './project-split.ts';

function canvas(id: string, nodes: ProjectCanvasView['nodes'] = []): ProjectView {
    return {
        kind: 'canvas',
        id,
        name: id,
        nodes,
        texts: [],
        edges: [],
        layouts: []
    };
}

function node(id: string, extra: Record<string, unknown> = {}): ProjectCanvasView['nodes'][number] {
    return { id, kind: 'chat', title: id, x: 0, y: 0, w: 100, h: 100, ...extra } as ProjectCanvasView['nodes'][number];
}

function chatView(id: string, extra: Record<string, unknown> = {}): ProjectView {
    return { kind: 'chat', id, name: id, node: extra };
}

function separator(id: string): ProjectView {
    return { kind: 'separator', id, name: id };
}

function subheader(id: string): ProjectView {
    return { kind: 'subheader', id, name: id };
}

function content(views: ProjectView[]): ProjectContent {
    return { name: 'repo', color: '#7c74ff', views };
}

const fallback = { name: 'repo', color: '#7c74ff' };

function sharedFileOf(views: ProjectView[]): ProjectSharedFile {
    return { version: PROJECT_VERSION, ...fallback, views };
}

function parsedSharedFile(views: ProjectView[]): ProjectSharedFile {
    return ProjectSharedFileSchema.parse(sharedFileOf(views));
}

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

    test('a name a session gave waits in the overlay, and the shared file carries the name of the kind', () => {
        const views = [
            canvas('main', [node('n1', { title: 'Fix the login', titleSource: 'auto' }), node('n2', { title: 'Mine', titleSource: 'user' })]),
            { ...chatView('c1', { resume: 'sess-1' }), name: 'Refactor auth', titleSource: 'auto' } as ProjectView
        ];
        const split = splitContent(content(views), ['main', 'c1'], 1);
        const [main, chat] = split.shared.views as [ProjectCanvasView, ProjectView];
        expect(main.nodes[0]).toEqual(node('n1', { title: 'New chat' }));
        expect(main.nodes[1]).toEqual(node('n2', { title: 'Mine', titleSource: 'user' }));
        expect(chat).toEqual({ ...chatView('c1'), name: 'New chat' });
        expect(split.private.overlay).toEqual({ n1: { title: 'Fix the login' }, c1: { resume: 'sess-1', name: 'Refactor auth' } });
    });

    test('a session renaming a shared node leaves the shared file as it was', () => {
        const named = (title: string) => content([canvas('main', [node('n1', { title, titleSource: 'auto' })])]);
        const before = splitContent(named('First prompt'), ['main'], 1);
        const after = splitContent(named('What the CLI called it'), ['main'], 2);
        expect(after.shared).toEqual(before.shared);
    });

    test('a kind without a name of its own keeps the name a session gave in the shared file', () => {
        const main = { ...canvas('main'), name: 'Named', titleSource: 'auto' } as ProjectView;
        expect(splitContent(content([main]), ['main'], 1).shared.views[0]).toEqual(main);
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

    test('a file view that climbs out of the project folder is kept back like an absolute one', () => {
        const climbing: ProjectView = { kind: 'file', id: 'f1', name: 'notes', path: '../x' };
        expect(viewShareRefusal(climbing)).toBe('path-outside-project');
        expect(canShareView({ ...climbing, path: 'docs/../README.md' })).toBe(true);
        expect(splitContent(content([climbing]), ['f1'], 1).shared.views).toEqual([]);
    });

    test('a design whose folder is off the project folder is kept back, and one inside it travels with its chat', () => {
        const outside: ProjectDesignView = { kind: 'design', id: 'd1', name: 'Old', node: { provider: 'claude' }, path: '/home/bas/designs' };
        const inside: ProjectDesignView = { kind: 'design', id: 'd2', name: 'Onboarding', node: { provider: 'claude' }, path: 'designs/onboarding' };
        expect(viewShareRefusal(outside)).toBe('path-outside-project');
        expect(viewShareRefusal({ ...inside, path: '../designs' })).toBe('path-outside-project');
        expect(canShareView(inside)).toBe(true);
        const split = splitContent(content([outside, inside]), ['d1', 'd2'], 1);
        expect(split.shared.views).toEqual([inside]);
    });

    test('a design node off the project folder on a shared canvas keeps its folder back and is no design anywhere', () => {
        const outside = node('n1', { kind: 'design', path: '/home/bas/designs' });
        const views = [canvas('main', [outside])];
        expect(designPlaces(views)).toEqual([]);

        const split = splitContent(content(views), ['main'], 1);
        expect((split.shared.views[0] as ProjectCanvasView).nodes[0]?.path).toBeUndefined();
        expect(split.private.overlay.n1).toEqual({ path: '/home/bas/designs' });

        const pushed = mergeFiles(parsedSharedFile([canvas('main', [node('n1', { kind: 'design', path: '../../elsewhere' })])]), EMPTY_PRIVATE_FILE, fallback);
        expect((pushed.content.views[0] as ProjectCanvasView).nodes[0]?.path).toBeUndefined();
    });

    test('a design holds its chat session under its own id, the way a chat view does', () => {
        const design: ProjectDesignView = {
            kind: 'design',
            id: 'd1',
            name: 'Onboarding',
            node: { provider: 'claude', resume: 'sess-9' },
            path: 'designs/onboarding'
        };
        const split = splitContent(content([design]), ['d1'], 1);
        expect(split.shared.views[0]).toEqual({ ...design, node: { provider: 'claude' } });
        expect(split.private.overlay.d1).toEqual({ resume: 'sess-9' });
    });

    test("a design's folder is private until the design is shared, and a folder a design named itself stays put", () => {
        expect(designFolderOf({ path: 'onboarding' }, false)).toBe('.ruimte/private/designs/onboarding');
        expect(designFolderOf({ path: 'onboarding' }, true)).toBe('.ruimte/designs/onboarding');
        expect(designFolderOf({ path: 'designs/onboarding' }, false)).toBe('designs/onboarding');
    });

    test('a design whose name is no folder of its own is kept as it was read and is no design anywhere', () => {
        expect(['onboarding', 'Pricing v2', 'designs/onboarding'].every(isDesignPath)).toBe(true);
        expect(['.', '..', '.hidden', 'a\\b', 'a\0b', ''].some(isDesignPath)).toBe(false);
        expect(['designs/.hidden', 'designs/v2.0'].every(isDesignPath)).toBe(true);
        expect(
            ['/etc/designs', '../../elsewhere', 'designs/../..', 'designs/./a', 'designs//a', 'designs/', 'C:/designs', 'a/b`c', 'a/b\nc', 'a\u007fb'].some(
                isDesignPath
            )
        ).toBe(false);

        const raw = { kind: 'design', id: 'd1', name: 'Everything', node: {}, path: '.' };
        const views = ProjectDocumentSchema.shape.views.parse([raw]);
        expect(views).toEqual([{ kind: 'unknown', id: 'd1', name: 'Everything', raw }]);
        expect(designPlaces(views)).toEqual([]);
        expect(storedViewsOf(splitContent(content(views), ['d1'], 1).shared.views)).toEqual([raw]);
    });

    test('one later chat of a design view this version cannot read never makes the file unreadable, and goes along as it is', () => {
        const chats = [{ id: 'd1-2', name: 'Dark', node: { resume: 'sess-2' } }, { id: 'd1-3' }];
        const [view] = ProjectDocumentSchema.shape.views.parse([{ kind: 'design', id: 'd1', name: 'Onboarding', node: {}, path: 'onboarding', chats }]);
        expect(viewChats(view!).map((chat) => chat.id)).toEqual(['d1', 'd1-2']);

        const split = splitContent(content([view!]), ['d1'], 1);
        expect((split.shared.views[0] as ProjectDesignView).chats).toEqual([{ id: 'd1-2', name: 'Dark', node: {} }, { id: 'd1-3' }]);
        expect(split.private.overlay['d1-2']).toEqual({ resume: 'sess-2' });
    });

    test('every later chat of a design keeps its session under its own id, out of the shared file', () => {
        const design: ProjectDesignView = {
            kind: 'design',
            id: 'd1',
            name: 'Onboarding',
            node: { provider: 'claude' },
            path: 'designs/onboarding',
            chats: [{ id: 'd1-2', name: 'Dark mode', node: { provider: 'codex', resume: 'thread-4', cwd: '/home/bas/repo' } }]
        };
        const split = splitContent(content([design]), ['d1'], 1);
        expect(split.shared.views[0]).toEqual({ ...design, chats: [{ id: 'd1-2', name: 'Dark mode', node: { provider: 'codex' } }] });
        expect(split.private.overlay['d1-2']).toEqual({ resume: 'thread-4', cwd: '/home/bas/repo' });
    });

    test("a design node's later chats keep their sessions under their own ids out of the shared file, with its canvas", () => {
        const board = node('board', {
            kind: 'design',
            path: 'pricing',
            chats: [{ id: 'board-2', name: 'Dense', node: { provider: 'codex', resume: 'thread-4' } }]
        });
        const split = splitContent(content([canvas('c1', [board])]), ['c1'], 1);
        const [travelled] = (split.shared.views[0] as ProjectCanvasView).nodes;
        expect(travelled!.chats).toEqual([{ id: 'board-2', name: 'Dense', node: { provider: 'codex' } }]);
        expect(split.private.overlay['board-2']).toEqual({ resume: 'thread-4' });
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

    test('the SQL choices stay in the private file, since they name connections, and none leave no key behind', () => {
        const sql = { default: { connectionId: 'shop' }, files: { 'db/report.sql': { connectionId: 'stats', database: 'warehouse' } } };
        const split = splitContent({ ...content([canvas('main')]), sql }, ['main'], 1);
        expect(split.private.sql).toEqual(sql);
        expect(JSON.stringify(split.shared)).not.toContain('shop');
        expect('sql' in splitContent({ ...content([canvas('main')]), sql: {} }, [], 1).private).toBe(false);
    });

    test("a person's accounts stay in the private file and come back with it, and none leave no key behind", () => {
        const accounts = { claude: { default: 'client', off: ['private'] } };
        const split = splitContent({ ...content([canvas('main')]), accounts }, ['main'], 1);
        expect(split.private.accounts).toEqual(accounts);
        expect(JSON.stringify(split.shared)).not.toContain('client');
        expect(mergeFiles(null, split.private, fallback).content.accounts).toEqual(accounts);
        expect('accounts' in splitContent({ ...content([canvas('main')]), accounts: {} }, [], 1).private).toBe(false);
    });

    test('an id in the list that names no view of this project is ignored', () => {
        const split = splitContent(content([canvas('main')]), ['main', 'ghost'], 1);
        expect(split.shared.views.map((view) => view.id)).toEqual(['main']);
    });
});

describe('the machine a node runs on', () => {
    test('is written to neither file, whether the canvas travels or stays', () => {
        const views = [canvas('shared', [node('n1', { machine: 'B' })]), canvas('own', [node('n2', { machine: 'B' })]), chatView('c1', { machine: 'B' })];
        const split = splitContent(content(views), ['shared'], 1);
        expect(JSON.stringify(split.shared)).not.toContain('machine');
        expect(JSON.stringify(split.private)).not.toContain('machine');
        expect(split.private.views).toHaveLength(2);
    });

    test('is no more written than a hidden canvas, while a hidden chat is', () => {
        const hidden = { ...(canvas('peer-a', [node('n1')]) as ProjectCanvasView), hidden: true };
        const chat = { ...(chatView('inline') as Extract<ProjectView, { kind: 'chat' }>), hidden: true };
        const split = splitContent(content([hidden, canvas('shared'), chat]), ['shared', 'inline'], 1);
        expect(split.shared.views.map((view) => view.id)).toEqual(['shared', 'inline']);
        expect(split.shared.views.find((view) => view.id === 'shared')).not.toHaveProperty('hidden');
        expect(split.private.views.map((view) => ('hidden' in view ? view.hidden : undefined))).toEqual([undefined]);
        expect(split.shared.views.find((view) => view.id === 'inline')).toMatchObject({ hidden: true });
    });

    test('is not believed when a file names it', () => {
        const file = { ...EMPTY_PRIVATE_FILE, order: ['shared', 'own'], views: [canvas('own', [node('n2', { machine: 'B' })])] };
        const shared = sharedFileOf([canvas('shared', [node('n1', { machine: 'B' })])]);
        expect(JSON.stringify(mergeFiles(shared, file, fallback).content)).not.toContain('machine');
        const hiddenOwn = { ...(canvas('own') as ProjectCanvasView), hidden: true };
        const hiddenShared = { ...(canvas('shared') as ProjectCanvasView), hidden: true };
        const merged = mergeFiles({ ...shared, views: [hiddenShared] }, { ...file, views: [hiddenOwn] }, fallback);
        expect(merged.content.views.some((view) => 'hidden' in view)).toBe(false);
    });
});

describe('mergeFiles', () => {
    test('what the split took apart comes back the same, overlay and order included', () => {
        const before = content([canvas('main', [node('n1', { resume: 'sess-1', cwd: '/etc' })]), chatView('c1', { resume: 'sess-2' }), canvas('own')]);
        const split = splitContent(before, ['main', 'c1'], 3);
        expect(mergeFiles(split.shared, split.private, fallback)).toEqual({ content: before, shared: ['main', 'c1'], overlayFields: [] });
    });

    test('the names sessions gave come back over the shared file', () => {
        const before = content([
            canvas('main', [node('n1', { title: 'Fix the login', titleSource: 'auto' })]),
            { ...chatView('c1'), name: 'Refactor auth', titleSource: 'auto' } as ProjectView
        ]);
        const split = splitContent(before, ['main', 'c1'], 3);
        expect(mergeFiles(split.shared, split.private, fallback).content).toEqual(before);
    });

    test('a name a person gave in the shared file wins over the one a session gave here', () => {
        const shared = sharedFileOf([
            canvas('main', [node('n1', { title: 'Theirs', titleSource: 'user' })]),
            { ...chatView('c1'), name: 'Also theirs', titleSource: 'user' } as ProjectView
        ]);
        const merged = mergeFiles(shared, { ...EMPTY_PRIVATE_FILE, overlay: { n1: { title: 'Mine' }, c1: { name: 'Also mine' } } }, fallback);
        expect(merged.content.views).toEqual(shared.views);
    });

    test('the flags come back over both files', () => {
        const before = { ...content([canvas('main', [node('n1')]), chatView('c1')]), flags: { main: 'red', n1: 'blue', c1: 'green' } };
        const split = splitContent(before, ['main'], 2);
        expect(mergeFiles(split.shared, split.private, fallback).content).toEqual(before);
    });

    test('the SQL choices come back from the private file', () => {
        const before = { ...content([canvas('main')]), sql: { files: { 'a.sql': { connectionId: null } } } };
        const split = splitContent(before, [], 2);
        expect(mergeFiles(split.shared, split.private, fallback).content).toEqual(before);
    });

    test('a shared view the private file never heard of falls in behind the one before it', () => {
        const shared = sharedFileOf([canvas('a'), canvas('new'), canvas('b')]);
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
        const shared = sharedFileOf([
            canvas('main', [node('n1', pushed), node('n2', { cwd: './apps', path: 'README.md' })]),
            chatView('c1', { provider: 'claude', cwd: 'C:\\' })
        ]);
        const merged = mergeFiles(shared, { ...EMPTY_PRIVATE_FILE, overlay: { n2: { resume: 'mine' } } }, fallback);
        const [main, chat] = merged.content.views as [ProjectCanvasView, ProjectView];
        expect(main.nodes[0]).toEqual(node('n1'));
        // What travels legitimately stays, and this person's own overlay is still laid over it.
        expect(main.nodes[1]).toEqual(node('n2', { cwd: './apps', path: 'README.md', resume: 'mine' }));
        expect(chat).toEqual(chatView('c1', { provider: 'claude' }));
    });

    test('a shared file view off the project folder is dropped, since a checkout cannot have put it there', () => {
        const shared = sharedFileOf([
            { kind: 'file', id: 'f1', name: 'README', path: '/Users/victim/.ssh/id_ed25519' },
            { kind: 'file', id: 'f2', name: 'NOTES', path: '../../.aws/credentials' },
            { kind: 'file', id: 'f3', name: 'C', path: 'C:\\Windows\\win.ini' },
            { kind: 'file', id: 'f4', name: 'readme', path: 'README.md' }
        ]);
        const merged = mergeFiles(shared, EMPTY_PRIVATE_FILE, fallback);
        expect(merged.content.views.map((view) => view.id)).toEqual(['f4']);
        expect(merged.shared).toEqual(['f4']);
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

describe("fields a newer Ruimte keeps one person's", () => {
    const overlayFile = (overlayFields?: string[]) => ({
        ...EMPTY_PRIVATE_FILE,
        overlay: { n1: { sandbox: 'B' } as never },
        order: ['main'],
        ...(overlayFields ? { overlayFields } : {})
    });
    const sharedOf = (...nodes: ProjectCanvasView['nodes']) => sharedFileOf([canvas('main', nodes)]);
    const nodesOf = (file: { views: ProjectView[] }) => (file.views[0] as ProjectCanvasView).nodes;

    test('a listed field in the overlay merges onto the node and splits back without reaching the shared file', () => {
        const merged = mergeFiles(sharedOf(node('n1')), overlayFile(['sandbox']), fallback);
        expect(nodesOf(merged.content)[0]).toEqual(node('n1', { sandbox: 'B' }));
        const split = splitContent(merged.content, merged.shared, 2, merged.overlayFields);
        expect(nodesOf(split.shared)[0]).toEqual(node('n1'));
        expect(split.private.overlay.n1).toEqual({ sandbox: 'B' } as never);
        expect(split.private.overlayFields).toEqual(['sandbox']);
    });

    test('a duplicate under a new id moves its private field into the overlay too', () => {
        const split = splitContent(content([canvas('main', [node('copy', { sandbox: 'B' })])]), ['main'], 1, ['sandbox']);
        expect(nodesOf(split.shared)[0]).toEqual(node('copy'));
        expect(split.private.overlay.copy).toEqual({ sandbox: 'B' } as never);
    });

    test('a field found in the overlay is private without a list, and the written file names it', () => {
        const merged = mergeFiles(sharedOf(node('n1')), overlayFile(), fallback);
        expect(merged.overlayFields).toEqual(['sandbox']);
        const split = splitContent(merged.content, merged.shared, 2, merged.overlayFields);
        expect(split.private.overlay.n1).toEqual({ sandbox: 'B' } as never);
        expect(split.private.overlayFields).toEqual(['sandbox']);
    });

    test('the field is dropped from the shared file when listed', () => {
        const merged = mergeFiles(sharedOf(node('n1', { sandbox: 'theirs' }), node('n2', { sandbox: 'theirs' })), overlayFile(['sandbox']), fallback);
        expect(nodesOf(merged.content)[0]).toEqual(node('n1', { sandbox: 'B' }));
        expect(nodesOf(merged.content)[1]).toEqual(node('n2'));
    });

    test('a listed field this version knows stays where it was', () => {
        const file = { ...EMPTY_PRIVATE_FILE, overlayFields: ['command', 'sandbox'] };
        expect(privateFieldsOf(file)).toEqual(['sandbox']);
        const split = splitContent(content([canvas('main', [node('n1', { command: 'ls' })])]), ['main'], 1, ['command']);
        expect(nodesOf(split.shared)[0]).toEqual(node('n1', { command: 'ls' }));
        expect(split.private.overlay).toEqual({});
        expect('overlayFields' in split.private).toBe(false);
    });

    test('a name every object inherits is no private field, listed or not', () => {
        const file = { ...EMPTY_PRIVATE_FILE, overlayFields: ['constructor', 'toString', '__proto__', 'sandbox'] };
        expect(privateFieldsOf(file)).toEqual(['sandbox']);
        const split = splitContent(content([canvas('main', [node('n1', { sandbox: 'B' })])]), ['main'], 1, ['constructor', 'toString', 'sandbox']);
        expect(split.private.overlay.n1).toEqual({ sandbox: 'B' } as never);
        expect(split.private.overlayFields).toEqual(['sandbox']);
        expect(nodesOf(split.shared)[0]).toEqual(node('n1'));
    });

    test('a view moved to the private file keeps the field inline, and sharing it again puts it back in the overlay', () => {
        const before = content([canvas('main', [node('n1', { sandbox: 'B' })])]);
        const privateSplit = splitContent(before, [], 1, ['sandbox']);
        expect(nodesOf({ views: privateSplit.private.views })[0]).toEqual(node('n1', { sandbox: 'B' }));
        expect(privateSplit.private.overlayFields).toEqual(['sandbox']);
        const merged = mergeFiles(null, privateSplit.private, fallback);
        const again = splitContent(merged.content, ['main'], 2, merged.overlayFields);
        expect(nodesOf(again.shared)[0]).toEqual(node('n1'));
        expect(again.private.overlay.n1).toEqual({ sandbox: 'B' } as never);
    });

    test('an unknown field that is not private goes to the shared file', () => {
        const split = splitContent(content([canvas('main', [node('n1', { location: { line: 3 } })])]), ['main'], 1, ['sandbox']);
        expect(nodesOf(split.shared)[0]).toEqual(node('n1', { location: { line: 3 } }));
        expect(split.private.overlay).toEqual({});
    });

    test('a known key in the overlay never moves a shared node', () => {
        const file = { ...EMPTY_PRIVATE_FILE, overlay: { n1: { x: 900, resume: 'mine' } as never } };
        const merged = mergeFiles(sharedOf(node('n1')), file, fallback);
        expect(nodesOf(merged.content)[0]).toEqual(node('n1', { resume: 'mine' }));
        expect(merged.overlayFields).toEqual([]);
    });
});

describe('an artifact node', () => {
    const reference = { id: 'art-1', version: 'ver-3' };
    const frame = { id: 'out', kind: 'artifact', title: 'Morning summary', x: 0, y: 0, w: 440, h: 520 };
    const nodesOf = (views: readonly unknown[]) => (views[0] as ProjectCanvasView).nodes;

    test('keeps what it shows in the overlay, and the shared file holds only its kind and title', () => {
        const split = splitContent(content([canvas('main', [{ ...frame, artifact: reference } as never])]), ['main'], 1);
        expect(storedViewsOf(split.shared.views)).toEqual([canvas('main', [frame as never])]);
        expect(JSON.stringify(split.shared)).not.toContain('art-1');
        expect(split.private.overlay.out).toEqual({ artifact: reference });
        expect('overlayFields' in split.private).toBe(false);

        const merged = mergeFiles(parsedSharedFile([canvas('main', [frame as never])]), split.private, fallback);
        expect(nodesOf(merged.content.views)[0]).toEqual({ ...frame, artifact: reference } as never);
    });

    test("never takes a reference from the shared file, which is anyone's who can push", () => {
        const merged = mergeFiles(
            parsedSharedFile([canvas('main', [{ ...frame, artifact: { id: 'theirs' } } as never])]),
            { ...EMPTY_PRIVATE_FILE, order: ['main'] },
            fallback
        );
        expect(nodesOf(merged.content.views)[0]).toEqual(frame as never);
    });

    test('comes back unchanged through a Ruimte that knows neither the kind nor the field', () => {
        const older = { id: 'out', kind: 'unknown', title: 'Morning summary', x: 0, y: 0, w: 440, h: 520, raw: frame, artifact: reference };
        const split = splitContent(content([canvas('main', [older as never])]), ['main'], 2, ['artifact']);
        expect(storedViewsOf(split.shared.views)).toEqual([canvas('main', [frame as never])]);
        expect(JSON.stringify(split.shared)).not.toContain('art-1');
        expect(split.private.overlay.out).toEqual({ artifact: reference });
    });
});

describe('an artifact view', () => {
    const view: ProjectView = { kind: 'artifact', id: 'view-out', name: 'Morning summary', node: { artifact: { id: 'art-1', version: 'ver-3' } } };

    test('is never shared and stays whole in the private file', () => {
        expect(viewShareRefusal(view)).toBe('stays-on-machine');
        const split = splitContent(content([canvas('main'), view]), ['main', 'view-out'], 1);
        expect(split.shared.views.map((entry) => entry.id)).toEqual(['main']);
        expect(split.private.views).toEqual([view]);
        expect(JSON.stringify(split.shared)).not.toContain('art-1');
    });

    test('its node keeps the reference on the way in from the file', () => {
        const parsed = parsedSharedFile([view]);
        expect(parsed.views[0]).toEqual(view);
    });

    test('comes back unchanged through a Ruimte that does not know the kind', () => {
        const older = { kind: 'unknown', id: 'view-out', name: 'Morning summary', raw: view };
        const split = splitContent(content([canvas('main'), older as never]), ['main'], 2);
        expect(storedViewsOf(split.private.views)).toEqual([view]);
    });
});

describe('a routine node', () => {
    const frame = { id: 'morning', kind: 'routine', title: 'Morning summary', x: 0, y: 0, w: 400, h: 560, routine: 'morning-summary' };
    test('carries its routine in the shared file, where it names the same routine for a teammate', () => {
        const split = splitContent(content([canvas('main', [frame as never])]), ['main'], 1);
        expect(storedViewsOf(split.shared.views)).toEqual([canvas('main', [frame as never])]);
        expect(split.private.overlay).toEqual({});

        const merged = mergeFiles(parsedSharedFile([canvas('main', [frame as never])]), split.private, fallback);
        expect((merged.content.views[0] as ProjectCanvasView).nodes[0]).toEqual(frame as never);
    });

    test('comes back unchanged through a Ruimte that does not know the kind', () => {
        const older = { id: 'morning', kind: 'unknown', title: 'Morning summary', x: 0, y: 0, w: 400, h: 560, raw: frame };
        const split = splitContent(content([canvas('main', [older as never])]), ['main'], 2);
        expect(storedViewsOf(split.shared.views)).toEqual([canvas('main', [frame as never])]);
        expect(split.private.overlay).toEqual({});
    });

    test('in a private canvas stays in the private file whole', () => {
        const split = splitContent(content([canvas('main', [frame as never])]), [], 1);
        expect(split.shared.views).toEqual([]);
        expect(storedViewsOf(split.private.views)).toEqual([canvas('main', [frame as never])]);
    });
});

describe('a shared view of a kind this version does not know', () => {
    const raw = { kind: 'gallery', id: 'view-g', name: 'Gallery', node: { title: 'Gallery' } };
    const unknown = { kind: 'unknown', id: 'view-g', name: 'Gallery', raw } as never;

    test('keeps its entry in the overlay, which it has no node to give back', () => {
        const kept = { 'view-g': { picture: 'pic-1' } };
        const split = splitContent(content([canvas('main'), unknown]), ['main', 'view-g'], 3, [], kept);
        expect(storedViewsOf(split.shared.views)).toEqual([canvas('main'), raw as never]);
        expect(split.private.overlay).toEqual(kept);
    });

    test('lets an entry go once the view is gone', () => {
        const split = splitContent(content([canvas('main')]), ['main'], 3, [], { 'view-g': { picture: 'pic-1' } });
        expect(split.private.overlay).toEqual({});
    });
});
