import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectCanvasView, ProjectContent, ProjectDocument } from '@ruimte/contracts';
import type { SessionEvent } from '../sessions/manager.ts';
import { waitFor } from '../sessions/test-helpers.ts';
import { documentPathInFolder, fromPortable, toPortable } from './project-files.ts';
import { ProjectStore } from './project-store.ts';

let root: string;
let home: string;
let folder: string;
let store: ProjectStore;
let changed: SessionEvent[];
let summaries: SessionEvent[];
let unsubscribe: () => void;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-projects-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder);
    store = new ProjectStore(home);
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
        await store.save(opened.summary.projectId, 0, content());
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(changed).toEqual([]);

        const path = documentPathInFolder(folder);
        const pulled: ProjectDocument = { ...(JSON.parse(await readFile(path, 'utf8')) as ProjectDocument), rev: 7, name: 'from git' };
        await writeFile(path, JSON.stringify(pulled, null, 2));
        await waitFor(() => changed.length === 1, 'the change event');
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
        const local = { activeViewId: 'main', views: { main: { camera: { x: 1, y: 2, zoom: 0.5 }, focusedNodeId: 'n1' } }, panels };
        await store.saveLocal(opened.summary.projectId, local);
        const again = await store.openProject({ projectId: opened.summary.projectId });
        expect(again.local).toEqual(local);
        // A local file from before the panels lived in it still opens, on the defaults.
        await store.saveLocal(opened.summary.projectId, { activeViewId: null, views: {} });
        expect((await store.openProject({ projectId: opened.summary.projectId })).local.panels).toBeUndefined();
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

        summaries.length = 0;
        await writeFile(join(folder, '.ruimte', 'icon.png'), PNG);
        await waitFor(() => summaries.length >= 1, 'the summary event');
        expect(summaries.at(-1)).toMatchObject({ event: 'project.summary', payload: { summary: { icon: { kind: 'image', value: '.ruimte/icon.png' } } } });

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
        await waitFor(() => summaries.length >= 1, 'the summary event');
        expect(summaries.at(-1)).toMatchObject({ event: 'project.summary', payload: { summary: { projectId, closedAt: listed.closedAt } } });
        // It is only a place in the menu: the project itself is untouched and still opens.
        expect(listed.available).toBe(true);

        summaries.length = 0;
        const again = await store.openProject({ projectId });
        expect(again.summary.closedAt).toBeNull();
        expect((await store.list())[0]?.closedAt).toBeNull();
        await waitFor(() => summaries.length >= 1, 'the summary event');
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
        const restarted = new ProjectStore(home);
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
