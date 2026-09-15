import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ProjectCanvasView, ProjectContent, ProjectDocument } from '@ruimte/contracts';
import { FakeWatch } from '../fs/watch-test-helpers.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { DiagramStore } from './diagram-store.ts';
import { DrawingStore } from './drawing-store.ts';
import { documentPathInFolder, fromPortable, toPortable } from './project-files.ts';
import { ProjectStore } from './project-store.ts';

let root: string;
let home: string;
let folder: string;
let fake: FakeWatch;
let store: ProjectStore;
let changed: SessionEvent[];
let summaries: SessionEvent[];

/* The summary is written to disk before it goes out, so the loop yields until it has; no clock decides. */
const summarySent = async (): Promise<void> => {
    while (summaries.length === 0) {
        await new Promise((resolve) => setImmediate(resolve));
    }
};
let unsubscribe: () => void;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-projects-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder);
    fake = new FakeWatch();
    store = new ProjectStore(home, fake);
    changed = [];
    summaries = [];
    unsubscribe = store.subscribe('c1', (event) => {
        (event.event === 'project.summary' ? summaries : changed).push(event);
    });
});

afterEach(async () => {
    // The sink reads the arrays of whichever test is running, so a summary still on its way out
    // of the store being torn down would otherwise land in the next test's.
    unsubscribe();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

const content = (name = 'repo'): ProjectContent => ({
    name,
    color: '#123456',
    views: [
        {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            nodes: [{ id: 'n1', kind: 'terminal', title: 'shell', x: 0, y: 0, w: 560, h: 360, cwd: join(folder, 'apps', 'server') }],
            texts: [],
            edges: [],
            layouts: []
        }
    ]
});

/* Every test here works on projects whose views are canvases; this is the cast that says so. */
const canvas = (document: Pick<ProjectContent, 'views'>, at = 0): ProjectCanvasView => document.views[at] as ProjectCanvasView;

/* The watcher on the directory the project file lives in; the platform reports every write there, ours included. */
const projectDirWatcher = () => fake.on(dirname(documentPathInFolder(folder)));

describe('ProjectStore', () => {
    test('opening a folder creates the canvas file, lists it, and saves with a rising rev', async () => {
        const opened = await store.openProject({ folder });
        expect(opened.summary).toMatchObject({ name: 'repo', folder, available: true });
        expect(opened.document).toMatchObject({ version: 2, rev: 0 });
        expect(canvas(opened.document)).toMatchObject({ id: 'main', name: 'Canvas', nodes: [] });
        expect(opened.local).toEqual({ activeViewId: null, views: {} });

        expect(await store.save(opened.summary.projectId, 0, content())).toBe(1);
        expect(await store.save(opened.summary.projectId, 1, content('renamed'))).toBe(2);
        const onDisk = JSON.parse(await readFile(documentPathInFolder(folder), 'utf8')) as ProjectDocument;
        expect(onDisk.rev).toBe(2);
        // Relative on disk, absolute once read back.
        expect(canvas(onDisk).nodes[0]?.cwd).toBe('./apps/server');
        expect((await store.list())[0]).toMatchObject({ name: 'renamed', available: true });

        const again = await store.openProject({ projectId: opened.summary.projectId });
        expect(canvas(again.document).nodes[0]?.cwd).toBe(join(folder, 'apps', 'server'));
    });

    test('a save based on an older rev is refused', async () => {
        const opened = await store.openProject({ folder });
        await store.save(opened.summary.projectId, 0, content());
        await expect(store.save(opened.summary.projectId, 0, content())).rejects.toMatchObject({ code: 'rev-conflict' });
    });

    test('an outside edit is reported once with what is on disk, and our own write is not', async () => {
        const opened = await store.openProject({ folder });
        // Saved by the one client listening, which already holds what it wrote.
        await store.save(opened.summary.projectId, 0, content(), 'c1');
        projectDirWatcher().emit('project.json');
        await fake.settle();
        expect(changed).toEqual([]);

        // Another file in `.ruimte` is none of the project's business.
        projectDirWatcher().emit('notes.txt');
        expect(fake.pending).toBe(0);

        const path = documentPathInFolder(folder);
        const pulled: ProjectDocument = { ...(JSON.parse(await readFile(path, 'utf8')) as ProjectDocument), rev: 7, name: 'from git' };
        await writeFile(path, JSON.stringify(pulled, null, 2));
        projectDirWatcher().emit('project.json');
        projectDirWatcher().emit('project.json');
        expect(fake.pending).toBe(1);
        await fake.settle();
        expect(changed).toHaveLength(1);
        expect(changed[0]).toMatchObject({
            event: 'project.changed',
            payload: { projectId: opened.summary.projectId, document: { rev: 7, name: 'from git' } }
        });
        // The daemon now expects saves against the pulled rev.
        await expect(store.save(opened.summary.projectId, 1, content())).rejects.toMatchObject({ code: 'rev-conflict' });
        expect(await store.save(opened.summary.projectId, 7, content())).toBe(8);
    });

    test('a corrupt file is set aside and a fresh canvas takes its place', async () => {
        await mkdir(join(folder, '.ruimte'));
        await writeFile(documentPathInFolder(folder), '{ "version": 1, "rev": ');
        const opened = await store.openProject({ folder });
        expect(opened.document.rev).toBe(0);
        const files = await readdir(join(folder, '.ruimte'));
        expect(files.some((name) => name.startsWith('project.json.corrupt-'))).toBe(true);
        expect(files).toContain('project.json');
    });

    test('a canvas without a folder lives under the app data dir, and local state stays out of the shared file', async () => {
        const opened = await store.openProject({ name: 'scratch' });
        expect(opened.summary.folder).toBeNull();
        const panels = {
            panel: { open: true, kind: 'files' as const },
            preview: { open: true },
            panelWidth: 480,
            tabs: [{ path: '/scratch/notes.md', pinned: true }],
            activeTab: '/scratch/notes.md',
            expandedDirs: ['src/']
        };
        /* The split is machine state like the camera and the panel widths: a grid built on one
           screen has no business appearing on another, so it rides in this file and not in the project. */
        const layout = {
            columns: [
                { size: 0.6, cells: [{ viewId: 'main', size: 1 }] },
                { size: 0.4, cells: [{ viewId: 'notes', size: 1 }] }
            ],
            focus: { column: 1, cell: 0 }
        };
        const local = { activeViewId: 'main', views: { main: { camera: { center: { x: 1, y: 2 }, zoom: 0.5 }, focusedNodeId: 'n1' } }, panels, layout };
        await store.saveLocal(opened.summary.projectId, local);
        const again = await store.openProject({ projectId: opened.summary.projectId });
        expect(again.local).toEqual(local);
        // A local file from before the panels lived in it still opens, on the defaults.
        await store.saveLocal(opened.summary.projectId, { activeViewId: null, views: {} });
        const plain = (await store.openProject({ projectId: opened.summary.projectId })).local;
        expect(plain.panels).toBeUndefined();
        // A file from before the grid reads as the one cell it always was.
        expect(plain.layout).toBeUndefined();
        const files = await readdir(join(home, 'projects'));
        expect(files).toContain(`${opened.summary.projectId}.local.json`);

        await store.delete(opened.summary.projectId, true);
        expect(await readdir(join(home, 'projects'))).toEqual([]);
        // The registry is empty now, so listing seeds a new default canvas instead of the deleted one.
        expect((await store.list()).map((project) => project.projectId)).not.toContain(opened.summary.projectId);
    });

    test('deleting a folder project without removing files keeps the canvas on disk', async () => {
        const opened = await store.openProject({ folder });
        await store.delete(opened.summary.projectId, false);
        expect((await store.list()).map((project) => project.folder)).not.toContain(folder);
        expect(await readFile(documentPathInFolder(folder), 'utf8')).toContain('"version": 2');
    });

    test('a daemon nobody has opened a project on lists nothing, and listing makes nothing', async () => {
        expect(await store.list()).toEqual([]);
        expect(await store.list()).toEqual([]);
    });

    test('two opens at once both end up registered', async () => {
        const [a, b] = await Promise.all([store.openProject({ name: 'a' }), store.openProject({ name: 'b' })]);
        expect((await store.list()).map((project) => project.projectId).sort()).toEqual([a.summary.projectId, b.summary.projectId].sort());
    });

    test('an icon dropped into .ruimte is announced as a summary, and setIcon writes and removes the file', async () => {
        const opened = await store.openProject({ folder });
        expect(opened.summary.icon).toEqual({ kind: 'initial', value: 'R' });
        expect(opened.summary.nameSource).toBe('folder');

        // The summary goes out after the reload is done, so it is awaited as an event of its own.
        const summary = new Promise<SessionEvent>((resolve) => {
            store.subscribe('icon-listener', (event) => {
                if (event.event === 'project.summary') {
                    resolve(event);
                }
            });
        });
        await writeFile(join(folder, '.ruimte', 'icon.png'), PNG);
        projectDirWatcher().emit('icon.png');
        await fake.settle();
        expect(await summary).toMatchObject({ event: 'project.summary', payload: { summary: { icon: { kind: 'image', value: '.ruimte/icon.png' } } } });

        const cleared = await store.setIcon({ projectId: opened.summary.projectId, image: null });
        expect(cleared.icon).toEqual({ kind: 'initial', value: 'R' });

        const set = await store.setIcon({ projectId: opened.summary.projectId, image: { mime: 'image/png', base64: PNG.toString('base64') } });
        expect(set.icon).toMatchObject({ kind: 'image', value: '.ruimte/icon.png' });
        expect(await readFile(join(folder, '.ruimte', 'icon.png'))).toEqual(PNG);
    });

    test('setIcon refuses bytes that are not an image, whatever the client calls them', async () => {
        const opened = await store.openProject({ folder });
        const payload = { projectId: opened.summary.projectId, image: { mime: 'image/png', base64: Buffer.from('#!/bin/sh\nrm -rf /\n').toString('base64') } };
        await expect(store.setIcon(payload)).rejects.toMatchObject({ code: 'bad-icon' });
        await expect(
            store.setIcon({ projectId: opened.summary.projectId, image: { mime: 'image/png', base64: Buffer.alloc(300 * 1024).toString('base64') } })
        ).rejects.toMatchObject({ code: 'bad-icon' });
    });

    test('a chosen icon wins from the folder and rides along in the list', async () => {
        const opened = await store.openProject({ folder });
        await writeFile(join(folder, '.ruimte', 'icon.png'), PNG);
        await store.save(opened.summary.projectId, 0, { ...content(), icon: { kind: 'lucide', value: 'rocket' } });
        expect((await store.list())[0]!.icon).toEqual({ kind: 'lucide', value: 'rocket' });
    });

    test('a first open seeds the name from .idea/.name and writes it into the canvas', async () => {
        await mkdir(join(folder, '.idea'), { recursive: true });
        await writeFile(join(folder, '.idea', '.name'), 'Ruimte Daemon\n');
        const opened = await store.openProject({ folder });
        expect(opened.summary.name).toBe('Ruimte Daemon');
        expect(opened.summary.nameSource).toBe('chosen');
        expect(opened.document.name).toBe('Ruimte Daemon');
        const onDisk = JSON.parse(await readFile(documentPathInFolder(folder), 'utf8')) as ProjectDocument;
        expect(onDisk.name).toBe('Ruimte Daemon');
    });

    test('.idea/.name is never read again once the canvas exists', async () => {
        await mkdir(join(folder, '.idea'), { recursive: true });
        await writeFile(join(folder, '.idea', '.name'), 'Ruimte Daemon\n');
        const opened = await store.openProject({ folder });
        await store.save(opened.summary.projectId, 0, content('Chosen by hand'));

        await writeFile(join(folder, '.idea', '.name'), 'Renamed In The IDE\n');
        const reopened = await store.openProject({ folder });
        expect(reopened.summary.name).toBe('Chosen by hand');
        expect(reopened.document.name).toBe('Chosen by hand');
        expect((await store.list())[0]).toMatchObject({ name: 'Chosen by hand' });
    });

    test('a version-1 file opens as one canvas view and is written back as version 2', async () => {
        await mkdir(join(folder, '.ruimte'));
        const legacy = {
            version: 1,
            rev: 11,
            name: 'ruimte',
            color: '#7c74ff',
            nodes: [{ id: 'terminal-1', kind: 'terminal', title: 'Terminal', x: -584, y: -592, w: 560, h: 360, cwd: join(folder, 'apps') }],
            texts: [],
            edges: [],
            layouts: []
        };
        await writeFile(documentPathInFolder(folder), `${JSON.stringify(legacy, null, 2)}\n`);

        const opened = await store.openProject({ folder });
        expect(opened.document).toMatchObject({ version: 2, rev: 11, name: 'ruimte' });
        expect(opened.document.views).toHaveLength(1);
        expect(canvas(opened.document)).toMatchObject({ id: 'main', name: 'Canvas' });
        expect(canvas(opened.document).nodes[0]?.cwd).toBe(join(folder, 'apps'));
        // A project that is only read stays readable for an older build; the first save moves it on.
        expect(await readFile(documentPathInFolder(folder), 'utf8')).toContain('"version": 1');

        await store.save(opened.summary.projectId, 11, { ...content(), views: opened.document.views });
        const onDisk = JSON.parse(await readFile(documentPathInFolder(folder), 'utf8')) as ProjectDocument;
        expect(onDisk).toMatchObject({ version: 2, rev: 12 });
        expect(canvas(onDisk).nodes[0]?.cwd).toBe('./apps');
    });

    test('a file with the same id in two views is refused with a message that names it', async () => {
        await mkdir(join(folder, '.ruimte'));
        const twice = {
            version: 2,
            rev: 1,
            name: 'repo',
            color: '#123456',
            views: [
                {
                    kind: 'canvas',
                    id: 'main',
                    name: 'Canvas',
                    nodes: [{ id: 'n1', kind: 'terminal', title: 'a', x: 0, y: 0, w: 1, h: 1 }],
                    texts: [],
                    edges: []
                },
                {
                    kind: 'canvas',
                    id: 'other',
                    name: 'Other',
                    nodes: [{ id: 'n1', kind: 'terminal', title: 'b', x: 0, y: 0, w: 1, h: 1 }],
                    texts: [],
                    edges: []
                }
            ]
        };
        await writeFile(documentPathInFolder(folder), JSON.stringify(twice));
        await expect(store.openProject({ folder })).rejects.toMatchObject({ code: 'project-invalid', message: expect.stringContaining('"n1"') });
        // Refused, not set aside: only a person can say which of the two was meant.
        expect(await readdir(join(folder, '.ruimte'))).toEqual(['project.json']);
    });

    test('an edge that points into another view is dropped on the way in', async () => {
        await mkdir(join(folder, '.ruimte'));
        const crossing = {
            version: 2,
            rev: 1,
            name: 'repo',
            color: '#123456',
            views: [
                {
                    kind: 'canvas',
                    id: 'main',
                    name: 'Canvas',
                    nodes: [{ id: 'n1', kind: 'terminal', title: 'a', x: 0, y: 0, w: 1, h: 1 }],
                    texts: [],
                    edges: [
                        { id: 'e1', from: 'n1', to: 'far' },
                        { id: 'e2', from: 'n1', to: 'n1' }
                    ]
                },
                { kind: 'canvas', id: 'other', name: 'Other', nodes: [{ id: 'far', kind: 'chat', title: 'b', x: 0, y: 0, w: 1, h: 1 }], texts: [], edges: [] }
            ]
        };
        await writeFile(documentPathInFolder(folder), JSON.stringify(crossing));
        const opened = await store.openProject({ folder });
        expect(canvas(opened.document).edges.map((edge) => edge.id)).toEqual(['e2']);
    });

    test('closing a project drops it under Recent, and opening it again takes it back out', async () => {
        const opened = await store.openProject({ folder });
        const { projectId } = opened.summary;
        expect(opened.summary.closedAt).toBeNull();

        await store.closeProject(projectId);
        const listed = (await store.list()).find((project) => project.projectId === projectId)!;
        expect(listed.closedAt).toBeNumber();
        /* The other clients hear it, so every machine draws the same list. The summary goes out
           after the answer does, so it is waited for rather than read off the call before it. */
        await summarySent();
        expect(summaries.at(-1)).toMatchObject({ event: 'project.summary', payload: { summary: { projectId, closedAt: listed.closedAt } } });
        // It is only a place in the menu: the project itself is untouched and still opens.
        expect(listed.available).toBe(true);

        summaries.length = 0;
        const again = await store.openProject({ projectId });
        expect(again.summary.closedAt).toBeNull();
        expect((await store.list())[0]?.closedAt).toBeNull();
        await summarySent();
        expect(summaries.at(-1)).toMatchObject({ event: 'project.summary', payload: { summary: { projectId, closedAt: null } } });
    });

    test('a project that is closed while it is open is let go of as well', async () => {
        const { summary } = await store.openProject({ folder });
        await store.closeProject(summary.projectId);
        expect(store.openProjectIds()).toEqual([]);
        // Nothing was saved or removed, so the canvas is still where it was.
        expect(await readFile(documentPathInFolder(folder), 'utf8')).toContain('"version": 2');
    });

    test('closing survives a restart, because the registry carries it and not the client', async () => {
        const { summary } = await store.openProject({ folder });
        await store.closeProject(summary.projectId);
        const restarted = new ProjectStore(home, fake);
        expect((await restarted.list())[0]?.closedAt).toBeNumber();
    });

    test('letting go of a project leaves the list where it was', async () => {
        const { summary } = await store.openProject({ folder });
        summaries.length = 0;
        store.release(summary.projectId);
        expect(store.openProjectIds()).toEqual([]);
        expect((await store.list())[0]?.closedAt).toBeNull();
        expect(summaries).toEqual([]);
    });

    test('closing a project nobody knows is refused', async () => {
        await expect(store.closeProject('nope')).rejects.toMatchObject({ code: 'project-not-found' });
    });

    test('a folder that is gone and an unknown id are refused', async () => {
        await expect(store.openProject({ folder: join(root, 'nope') })).rejects.toMatchObject({ code: 'folder-not-found' });
        await expect(store.openProject({ projectId: 'nope' })).rejects.toMatchObject({ code: 'project-not-found' });
    });

    test('createFolder makes every missing folder on the way and opens the last one', async () => {
        const deep = join(root, 'a', 'b', 'c');
        const opened = await store.openProject({ folder: deep, createFolder: true });
        expect(opened.summary.folder).toBe(deep);
        expect(opened.summary.name).toBe('c');
        expect(await readFile(documentPathInFolder(deep), 'utf8')).toContain('"version": 2');
    });

    test('createFolder onto a file leaves the file alone and still reads as no folder', async () => {
        const file = join(root, 'notes.txt');
        await writeFile(file, 'keep me');
        await expect(store.openProject({ folder: file, createFolder: true })).rejects.toMatchObject({ code: 'folder-not-found' });
        expect(await readFile(file, 'utf8')).toBe('keep me');
    });
});

describe('the project index', () => {
    const linked = (body: string): ProjectContent => ({
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [
                    { id: 'agent', kind: 'terminal', title: 'shell', x: 0, y: 0, w: 560, h: 360 },
                    { id: 'plan', kind: 'note', title: 'Plan', x: 0, y: 0, w: 200, h: 200, body },
                    { id: 'readme', kind: 'file', title: 'README.md', x: 0, y: 0, w: 200, h: 200, path: 'README.md' }
                ],
                texts: [],
                edges: [
                    { id: 'e1', from: 'plan', to: 'agent' },
                    { id: 'e2', from: 'readme', to: 'agent' }
                ],
                layouts: []
            }
        ]
    });

    test('a save changes what an agent reads, and letting go of the project keeps it readable', async () => {
        const opened = await store.openProject({ folder });
        const { projectId } = opened.summary;
        expect(store.index.sourcesFor('agent')).toEqual([]);

        await store.save(projectId, 0, linked('first'));
        expect(store.index.sourcesFor('agent')).toEqual([
            { id: 'plan', kind: 'text', title: 'Plan', text: 'first' },
            { id: 'readme', kind: 'file', title: 'README.md', text: join(folder, 'README.md') }
        ]);
        await store.save(projectId, 1, linked('second'));
        expect(store.index.sourcesFor('agent')[0]).toMatchObject({ text: 'second' });

        // Switching away is what `release` is; the shell on that canvas keeps running and keeps its links.
        store.release(projectId);
        expect(store.index.sourcesFor('agent')[0]).toMatchObject({ text: 'second' });
        await store.closeProject(projectId);
        expect(store.index.locate('agent')).toEqual({ projectId, folder, canvasId: 'main' });

        await store.delete(projectId, false);
        expect(store.index.sourcesFor('agent')).toEqual([]);
    });

    test('warming reads a project nobody opened since the daemon started', async () => {
        const opened = await store.openProject({ folder });
        await store.save(opened.summary.projectId, 0, linked('from disk'));
        await store.closeProject(opened.summary.projectId);

        const restarted = new ProjectStore(home, fake);
        expect(restarted.index.sourcesFor('agent')).toEqual([]);
        await restarted.warmIndex();
        expect(restarted.index.sourcesFor('agent')[0]).toMatchObject({ text: 'from disk' });
        expect(restarted.openProjectIds()).toEqual([]);
    });

    test('warming skips a project whose file is gone or will not parse, and starts anyway', async () => {
        const opened = await store.openProject({ folder });
        await store.save(opened.summary.projectId, 0, linked('x'));
        await writeFile(documentPathInFolder(folder), '{ not json');

        const restarted = new ProjectStore(home, fake);
        await restarted.warmIndex();
        expect(restarted.index.has(opened.summary.projectId)).toBe(false);
        // Nobody asked for that file, so it is not set aside the way an open would.
        expect(await readFile(documentPathInFolder(folder), 'utf8')).toBe('{ not json');
    });
});

describe('portable paths', () => {
    test('paths inside the folder go relative, the folder itself is a dot, outside stays absolute', () => {
        const portable = toPortable(
            {
                name: 'x',
                color: '',
                views: [
                    {
                        kind: 'canvas',
                        id: 'main',
                        name: 'Canvas',
                        nodes: [
                            { id: 'a', kind: 'terminal', title: '', x: 0, y: 0, w: 1, h: 1, cwd: '/repo/apps' },
                            { id: 'b', kind: 'terminal', title: '', x: 0, y: 0, w: 1, h: 1, cwd: '/repo' },
                            { id: 'c', kind: 'terminal', title: '', x: 0, y: 0, w: 1, h: 1, cwd: '/elsewhere' },
                            { id: 'd', kind: 'chat', title: '', x: 0, y: 0, w: 1, h: 1 }
                        ],
                        texts: [],
                        edges: [],
                        layouts: []
                    },
                    { kind: 'terminal', id: 'e', name: 'deploy', node: { cwd: '/repo/apps/server' } }
                ]
            },
            '/repo'
        );
        expect(canvas(portable).nodes.map((node) => node.cwd)).toEqual(['./apps', '.', '/elsewhere', undefined]);
        // A standalone view carries a folder too, and travels the same way.
        expect(portable.views[1]).toMatchObject({ node: { cwd: './apps/server' } });
        const back = fromPortable(portable, '/repo');
        expect(canvas(back).nodes.map((node) => node.cwd)).toEqual(['/repo/apps', '/repo', '/elsewhere', undefined]);
        expect(back.views[1]).toMatchObject({ node: { cwd: '/repo/apps/server' } });
    });
});

describe('mutate', () => {
    const addNote = (id: string) => (current: ProjectContent) => {
        const [first, ...rest] = current.views;
        const view = first as ProjectCanvasView;
        const note = { id, kind: 'note' as const, title: 'Note', x: 0, y: 400, w: 320, h: 240, body: 'hello' };
        return { content: { ...current, views: [{ ...view, nodes: [...view.nodes, note] }, ...rest] }, result: id };
    };

    test('writes a released project to disk, tells every sink, and updates the index', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        await store.save(projectId, opened.document.rev, content());
        store.release(projectId);
        changed = [];

        expect(await store.mutate(projectId, addNote('note-1'))).toBe('note-1');

        const onDisk = JSON.parse(await readFile(documentPathInFolder(folder), 'utf8')) as ProjectDocument;
        expect(onDisk.rev).toBe(2);
        expect(canvas(onDisk).nodes.map((node) => node.id)).toEqual(['n1', 'note-1']);
        // The terminal's cwd went through the portable form and back, like a save.
        expect(canvas(onDisk).nodes[0]!.cwd).toBe('./apps/server');
        expect(changed).toHaveLength(1);
        expect(changed[0]).toMatchObject({ event: 'project.changed', payload: { projectId, document: { rev: 2 } } });
        expect(store.index.locate('note-1')).toEqual({ projectId, folder, canvasId: 'main' });

        const reopened = await store.openProject({ projectId });
        expect(reopened.document.rev).toBe(2);
        expect(canvas(reopened.document).nodes.map((node) => node.id)).toEqual(['n1', 'note-1']);
        expect(canvas(reopened.document).nodes[0]!.cwd).toBe(join(folder, 'apps', 'server'));
    });

    test('an open project takes the new rev, so the next save and the watcher agree with it', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        changed = [];
        await store.mutate(projectId, addNote('note-1'));
        projectDirWatcher().emit('project.json');
        await fake.settle();
        // Our own write, not an outside edit: the watcher does not send it a second time.
        expect(changed).toHaveLength(1);
        await expect(store.save(projectId, opened.document.rev, content())).rejects.toMatchObject({ code: 'rev-conflict' });
        expect(await store.save(projectId, 1, content())).toBe(2);
    });

    test('a throw from apply writes nothing', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        changed = [];
        await expect(
            store.mutate(projectId, () => {
                throw new Error('no');
            })
        ).rejects.toThrow('no');
        expect((JSON.parse(await readFile(documentPathInFolder(folder), 'utf8')) as ProjectDocument).rev).toBe(opened.document.rev);
        expect(changed).toEqual([]);
    });

    test('landed runs after the write and before the event, and never for a refused change', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        store.release(projectId);
        changed = [];
        const seen: Array<{ rev: number; events: number }> = [];
        const landed = async () => {
            const onDisk = JSON.parse(await readFile(documentPathInFolder(folder), 'utf8')) as ProjectDocument;
            seen.push({ rev: onDisk.rev, events: changed.length });
        };

        await store.mutate(projectId, (current) => ({ ...addNote('note-1')(current), landed }));
        expect(seen).toEqual([{ rev: opened.document.rev + 1, events: 0 }]);
        expect(changed).toHaveLength(1);

        await expect(store.mutate(projectId, (current) => ({ ...addNote('note-1')(current), landed }))).rejects.toMatchObject({ code: 'project-invalid' });
        await store.mutate(projectId, () => ({ content: null, result: null, landed }));
        expect(seen).toHaveLength(1);
    });

    test('refuses a project whose file is gone or unknown', async () => {
        const opened = await store.openProject({ folder });
        store.release(opened.summary.projectId);
        await rm(documentPathInFolder(folder));
        await expect(store.mutate(opened.summary.projectId, addNote('x'))).rejects.toMatchObject({ code: 'project-missing' });
        await expect(store.mutate('nope', addNote('x'))).rejects.toMatchObject({ code: 'project-not-found' });
    });
});

describe('kinds a newer Ruimte wrote', () => {
    const HOLOGRAM = { kind: 'hologram', id: 'holo', title: 'Hologram', x: 600, y: 40, w: 480, h: 360, beam: { lumens: [1, 2] } };
    const TIMELINE = { name: 'Flow', kind: 'timeline', id: 'timeline-1', tracks: [{ at: 0 }] };

    const newerFile = (): string =>
        `${JSON.stringify(
            {
                version: 2,
                rev: 3,
                name: 'repo',
                color: '#123456',
                views: [
                    { kind: 'canvas', id: 'main', name: 'Canvas', nodes: [HOLOGRAM], texts: [], edges: [], layouts: [] },
                    TIMELINE,
                    { kind: 'drawing', id: 'sketch', name: 'Sketch' },
                    { kind: 'diagram', id: 'chart', name: 'Chart' }
                ]
            },
            null,
            2
        )}\n`;

    /* The entries this daemon does not know, the way they stand in the file right now. */
    const unknownOnDisk = async (): Promise<string> => {
        const document = JSON.parse(await readFile(documentPathInFolder(folder), 'utf8')) as { views: Array<{ id: string; nodes?: unknown[] }> };
        return JSON.stringify([
            document.views.find((view) => view.id === 'main')!.nodes!.find((node) => (node as { id: string }).id === 'holo'),
            document.views.find((view) => view.id === 'timeline-1')
        ]);
    };

    const UNKNOWN = JSON.stringify([HOLOGRAM, TIMELINE]);

    beforeEach(async () => {
        await mkdir(join(folder, '.ruimte'), { recursive: true });
        await writeFile(documentPathInFolder(folder), newerFile());
    });

    test('opening such a file sets nothing aside and hands the entries on', async () => {
        const opened = await store.openProject({ folder });
        expect(await readdir(join(folder, '.ruimte'))).toEqual(['project.json']);
        expect(await readFile(documentPathInFolder(folder), 'utf8')).toBe(newerFile());
        expect(opened.document.views.map((view) => view.kind)).toEqual(['canvas', 'unknown', 'drawing', 'diagram']);
        expect(canvas(opened.document).nodes[0]).toMatchObject({ id: 'holo', kind: 'unknown', x: 600 });
    });

    test('a save that sends the entries back keeps them as they were, and one that moved the node moves it', async () => {
        const opened = await store.openProject({ folder });
        const { version: _version, rev, ...sent } = opened.document;
        await store.save(opened.summary.projectId, rev, sent);
        expect(await unknownOnDisk()).toBe(UNKNOWN);

        const main = canvas(sent);
        const moved = { ...sent, views: [{ ...main, nodes: [{ ...main.nodes[0]!, x: 0 }] }, ...sent.views.slice(1)] };
        await store.save(opened.summary.projectId, rev + 1, moved);
        expect(await unknownOnDisk()).toBe(JSON.stringify([{ ...HOLOGRAM, x: 0 }, TIMELINE]));
    });

    test('a mutation keeps them, open or released', async () => {
        const opened = await store.openProject({ folder });
        const { projectId } = opened.summary;
        const addText = (id: string) => (current: ProjectContent) => {
            const main = canvas(current);
            const text = { id, x: 0, y: 0, text: 'hi', size: 16 };
            return { content: { ...current, views: [{ ...main, texts: [...main.texts, text] }, ...current.views.slice(1)] }, result: null };
        };
        await store.mutate(projectId, addText('text-1'));
        expect(await unknownOnDisk()).toBe(UNKNOWN);
        store.release(projectId);
        await store.mutate(projectId, addText('text-2'));
        expect(await unknownOnDisk()).toBe(UNKNOWN);
        expect(store.index.locate('holo')).toEqual({ projectId, folder, canvasId: 'main' });
    });

    test('removing a drawing and a diagram leaves the files of an unknown view alone', async () => {
        const drawings = new DrawingStore(store, fake);
        const diagrams = new DiagramStore(store, fake);
        store.attachDrawings(drawings);
        store.attachDiagrams(diagrams);
        const opened = await store.openProject({ folder });
        const { projectId } = opened.summary;
        for (const dir of ['drawings', 'diagrams']) {
            await mkdir(join(folder, '.ruimte', dir), { recursive: true });
            await writeFile(join(folder, '.ruimte', dir, 'timeline-1.json'), '{}');
            await writeFile(join(folder, '.ruimte', dir, 'gone.json'), '{}');
        }

        const { version: _version, rev, ...sent } = opened.document;
        await store.save(projectId, rev, { ...sent, views: sent.views.filter((view) => view.id !== 'sketch' && view.id !== 'chart') });

        expect(await readdir(join(folder, '.ruimte', 'drawings'))).toEqual(['timeline-1.json']);
        expect(await readdir(join(folder, '.ruimte', 'diagrams'))).toEqual(['timeline-1.json']);
        expect(await unknownOnDisk()).toBe(UNKNOWN);
    });
});
