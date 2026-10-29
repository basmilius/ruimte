import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
    PROJECT_VERSION,
    ProjectOpenResultSchema,
    emptyCanvasView,
    withNodeAsView,
    type ProjectCanvasView,
    type ProjectContent,
    type ProjectView
} from '@ruimte/contracts';
import { FakeWatch } from '@adecore/agents/testing';
import type { SessionEvent } from '../sessions/manager.ts';
import { DiagramStore } from './diagram-store.ts';
import { DrawingStore } from './drawing-store.ts';
import { setProjectAccounts } from './project-accounts.ts';
import { documentOnDisk, privateFileOnDisk, rawPrivateViews, projectLinks, setPrivateViews } from './project-file-test-helpers.ts';
import { GITIGNORE_TEXT, documentPathInFolder, fromPortable, privatePathOf, toPortable } from './project-files.ts';
import { ProjectStore, type ProjectLinks } from './project-store.ts';
import { PROJECT_WRITE_IO } from './project-write.ts';

let root: string;
let home: string;
let folder: string;
let fake: FakeWatch;
let store: ProjectStore;
let links: ProjectLinks;
let changed: SessionEvent[];
let summaries: SessionEvent[];

/* The summary is written to disk before it goes out, so the loop yields until it has; no clock decides. */
async function summarySent(): Promise<void> {
    while (summaries.length === 0) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}
let unsubscribe: () => void;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-projects-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder);
    fake = new FakeWatch();
    links = projectLinks();
    store = new ProjectStore(home, links, fake);
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

function content(name = 'repo'): ProjectContent {
    return {
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
    };
}

/* Every test here works on projects whose views are canvases; this is the cast that says so. */
function canvas(document: Pick<ProjectContent, 'views'>, at = 0): ProjectCanvasView {
    return document.views[at] as ProjectCanvasView;
}

/* The watcher on the directory the project file lives in; the platform reports every write there, ours included. */
function projectDirWatcher() {
    return fake.on(dirname(documentPathInFolder(folder)));
}

/* The shared file as a pull leaves it: the same file under another name, not yet seen by the watcher. */
async function pull(name: string): Promise<void> {
    const path = documentPathInFolder(folder);
    const pulled = { ...(JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>), name };
    await writeFile(path, JSON.stringify(pulled, null, 2));
}

/* A change that adds a note to the first canvas, making one when the project has none. */
function addNote(id: string) {
    return (current: ProjectContent) => {
        const [first, ...rest] = current.views;
        const view = (first ?? emptyCanvasView('main', 'Canvas')) as ProjectCanvasView;
        const note = { id, kind: 'note' as const, title: 'Note', x: 0, y: 400, w: 320, h: 240, body: 'hello' };
        return { content: { ...current, views: [{ ...view, nodes: [...view.nodes, note] }, ...rest] }, result: id };
    };
}

describe('ProjectStore', () => {
    test('opening a folder creates an empty project, lists it, and saves with a rising rev', async () => {
        const opened = await store.openProject({ folder });
        expect(opened.summary).toMatchObject({ name: 'repo', folder, available: true });
        expect(opened.document).toMatchObject({ version: PROJECT_VERSION, rev: 0, shared: [] });
        expect(opened.document.views).toEqual([]);
        expect(ProjectOpenResultSchema.safeParse(opened).success).toBe(true);
        expect((await documentOnDisk(folder)).views).toEqual([]);
        expect((await store.openProject({ projectId: opened.summary.projectId })).document.views).toEqual([]);
        expect(opened.local).toEqual({ activeViewId: null, views: {} });

        expect(await store.save(opened.summary.projectId, 0, content())).toBe(1);
        expect(await store.save(opened.summary.projectId, 1, content('renamed'))).toBe(2);
        const onDisk = await documentOnDisk(folder);
        expect(onDisk.rev).toBe(2);
        // Relative on disk, absolute once read back.
        expect(canvas(onDisk).nodes[0]?.cwd).toBe('./apps/server');
        expect((await store.list())[0]).toMatchObject({ name: 'renamed', available: true });

        const again = await store.openProject({ projectId: opened.summary.projectId });
        expect(canvas(again.document).nodes[0]?.cwd).toBe(join(folder, 'apps', 'server'));
    });

    test('a color set with the identity goes into the shared file and the summary, and the rest of the identity stays', async () => {
        const opened = await store.openProject({ folder });
        const summary = await store.setIdentity({ projectId: opened.summary.projectId, color: '#e7000b' });
        expect(summary).toMatchObject({ name: 'repo', color: '#e7000b' });
        expect((await documentOnDisk(folder)).color).toBe('#e7000b');
        expect((await store.list())[0]).toMatchObject({ color: '#e7000b' });
    });

    test('a folder is never found against the folder the daemon runs in, nor in its own state', async () => {
        await expect(store.openProject({ folder: 'repo' })).rejects.toThrow('is not a full path');
        await mkdir(join(home, 'auth'), { recursive: true });
        await expect(store.openProject({ folder: join(home, 'auth') })).rejects.toThrow("belongs to this machine's own state");
        await expect(store.openProject({ folder: home, createFolder: true })).rejects.toThrow("belongs to this machine's own state");
        expect(await store.list()).toEqual([]);
    });

    test('a field a newer Ruimte put on an edge is written back and read again', async () => {
        const edge = { id: 'e1', from: 'n1', to: 'n2', label: 'context', relation: 'origin' };
        const base = content();
        const view = canvas(base);
        const withEdge: ProjectContent = {
            ...base,
            views: [{ ...view, nodes: [...view.nodes, { id: 'n2', kind: 'chat', title: 'chat', x: 600, y: 0, w: 560, h: 360 }], edges: [edge] }]
        };

        const opened = await store.openProject({ folder });
        await store.save(opened.summary.projectId, 0, withEdge);
        const onDisk = await documentOnDisk(folder);
        expect(canvas(onDisk).edges).toEqual([edge]);

        const again = await store.openProject({ projectId: opened.summary.projectId });
        expect(canvas(again.document).edges).toEqual([edge]);
    });

    test('the SQL choices live in the private file, and a save that does not send them keeps them', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        const sql = { default: { connectionId: 'shop' }, files: { 'db/a.sql': { connectionId: null } } };
        await store.mutate(projectId, (current) => ({ content: { ...current, sql }, result: undefined }));
        expect((await privateFileOnDisk(folder)).sql).toEqual(sql);
        expect(await readFile(documentPathInFolder(folder), 'utf8')).not.toContain('shop');
        await store.save(projectId, 1, content());
        expect((await privateFileOnDisk(folder)).sql).toEqual(sql);
        expect((await store.read(projectId)).sql).toEqual(sql);
    });

    test("a person's accounts live in the private file, and a save that does not send them keeps them", async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        const accounts = await setProjectAccounts(store, { projectId, kind: 'claude', default: 'client', off: ['private'] });
        expect(accounts).toEqual({ claude: { default: 'client', off: ['private'] } });
        expect((await privateFileOnDisk(folder)).accounts).toEqual(accounts);
        expect(await readFile(documentPathInFolder(folder), 'utf8')).not.toContain('client');
        await store.save(projectId, 1, content());
        expect((await privateFileOnDisk(folder)).accounts).toEqual(accounts);
        expect(store.index.accountsOf(projectId)).toEqual(accounts);
    });

    test('a save based on an older rev is refused', async () => {
        const opened = await store.openProject({ folder });
        await store.save(opened.summary.projectId, 0, content());
        await expect(store.save(opened.summary.projectId, 0, content())).rejects.toMatchObject({ code: 'rev-conflict' });
    });

    test('an outside edit is reported once with what is on disk, and our own write is not', async () => {
        const opened = await store.openProject({ folder });
        store.hold('c1', opened.summary.projectId);
        // Saved by the one client listening, which already holds what it wrote.
        await store.save(opened.summary.projectId, 0, content(), undefined, 'c1');
        projectDirWatcher().emit('project.json');
        await fake.settle();
        expect(changed).toEqual([]);

        // Another file in `.ruimte` is none of the project's business.
        projectDirWatcher().emit('notes.txt');
        expect(fake.pending).toBe(0);

        await pull('from git');
        projectDirWatcher().emit('project.json');
        projectDirWatcher().emit('project.json');
        expect(fake.pending).toBe(1);
        await fake.settle();
        expect(changed).toHaveLength(1);
        /* The rev of a pull is this machine's own and goes up by one: the shared file carries no rev,
           and every client here has to base its next save on what just arrived. */
        expect(changed[0]).toMatchObject({
            event: 'project.changed',
            payload: { projectId: opened.summary.projectId, document: { rev: 2, name: 'from git' } }
        });
        await expect(store.save(opened.summary.projectId, 1, content())).rejects.toMatchObject({ code: 'rev-conflict' });
        expect(await store.save(opened.summary.projectId, 2, content())).toBe(3);
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

    test('a file from a newer Ruimte keeps the project shut and is left exactly as it was', async () => {
        await mkdir(join(folder, '.ruimte'));
        const written = JSON.stringify({ version: PROJECT_VERSION + 1, rev: 4, name: 'later', color: '#000', views: [] });
        await writeFile(documentPathInFolder(folder), written);
        await expect(store.openProject({ folder })).rejects.toMatchObject({ code: 'project-too-new' });
        expect(await readFile(documentPathInFolder(folder), 'utf8')).toBe(written);
        expect(await readdir(join(folder, '.ruimte'))).toEqual(['project.json']);
    });

    test('a newer file refuses a verb too, so nothing an agent does writes over it', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        store.release(projectId);
        await writeFile(documentPathInFolder(folder), JSON.stringify({ version: PROJECT_VERSION + 1, rev: 9, name: 'later', color: '#000', views: [] }));
        await expect(store.read(projectId)).rejects.toMatchObject({ code: 'project-too-new' });
        await expect(store.mutate(projectId, (content) => ({ content, result: null }))).rejects.toMatchObject({ code: 'project-too-new' });
    });

    test('local state stays in the app data dir and out of the project folder', async () => {
        const opened = await store.openProject({ folder: join(root, 'scratch'), createFolder: true, name: 'scratch' });
        expect(opened.summary.folder).toBe(join(root, 'scratch'));
        const panels = {
            panel: { open: true, kind: 'files' as const },
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
        expect((await store.list()).map((project) => project.projectId)).not.toContain(opened.summary.projectId);
    });

    test('deleting a project has the provenance records of it forgotten, with or without its files, and a refusal there does not stop the delete', async () => {
        const forgotten: string[] = [];
        links.provenance = { forget: async (id) => void forgotten.push(id) };
        const first = await store.openProject({ folder });
        await store.delete(first.summary.projectId, false);
        expect(forgotten).toEqual([first.summary.projectId]);

        links.provenance = {
            forget: async () => {
                throw new Error('disk full');
            }
        };
        const second = await store.openProject({ folder });
        await store.delete(second.summary.projectId, true);
        expect((await store.list()).map((project) => project.projectId)).not.toContain(second.summary.projectId);
    });

    test('deleting a project has its schema snapshots forgotten, closing it does not', async () => {
        const forgotten: string[] = [];
        links.databases = { closeProject: () => undefined, forgetProject: async (id) => void forgotten.push(id) };
        const { projectId } = (await store.openProject({ folder })).summary;
        await store.closeProject(projectId, 'client-a');

        expect(forgotten).toEqual([]);

        await store.delete(projectId, false);

        expect(forgotten).toEqual([projectId]);
    });

    test('deleting a folder project without removing files keeps the canvas on disk', async () => {
        const opened = await store.openProject({ folder });
        await store.delete(opened.summary.projectId, false);
        expect((await store.list()).map((project) => project.folder)).not.toContain(folder);
        expect(await readFile(documentPathInFolder(folder), 'utf8')).toContain(`"version": ${PROJECT_VERSION}`);
    });

    test('deleting a project with its files takes its drawings and diagrams, shared or not, and then .ruimte', async () => {
        const drawings = new DrawingStore(store, fake);
        const diagrams = new DiagramStore(store, fake);
        links.viewFiles = () => [drawings, diagrams];
        const { projectId } = (await store.openProject({ folder })).summary;
        const views: ProjectContent['views'] = [
            ...content().views,
            { kind: 'drawing', id: 'sketch', name: 'Sketch' },
            { kind: 'diagram', id: 'chart', name: 'Chart' },
            { kind: 'drawing', id: 'scribble', name: 'Scribble' }
        ];
        await store.save(projectId, 0, { ...content(), views }, ['main', 'sketch', 'chart']);
        const element = { kind: 'rect' as const, id: 'e1', x: 0, y: 0, w: 160, h: 96, stroke: 'ink' as const, strokeWidth: 2 as const, seed: 12 };
        for (const viewId of ['sketch', 'scribble']) {
            await drawings.open(projectId, viewId);
            await drawings.save(projectId, viewId, 0, { elements: [element] });
        }
        await diagrams.open(projectId, 'chart');
        await diagrams.save(projectId, 'chart', 0, { meta: { title: '', direction: 'right' }, nodes: [{ id: 'a', label: 'a' }], groups: [], edges: [] });
        expect(await readdir(join(folder, '.ruimte', 'drawings'))).toEqual(['sketch.json']);
        expect(await readdir(join(folder, '.ruimte', 'diagrams'))).toEqual(['chart.json']);
        expect(await readdir(join(folder, '.ruimte', 'private', 'drawings'))).toEqual(['scribble.json']);

        await store.delete(projectId, true);
        expect(await readdir(folder)).toEqual([]);
    });

    test('a daemon nobody has opened a project on lists nothing, and listing makes nothing', async () => {
        const before = await readdir(root);
        expect(before).toEqual(['repo']);
        expect(await store.list()).toEqual([]);
        expect(await store.list()).toEqual([]);
        expect(await readdir(root)).toEqual(before);
        await expect(readdir(home)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    test('two opens at once both end up registered', async () => {
        const [a, b] = await Promise.all([
            store.openProject({ folder: join(root, 'a'), createFolder: true, name: 'a' }),
            store.openProject({ folder: join(root, 'b'), createFolder: true, name: 'b' })
        ]);
        expect((await store.list()).map((project) => project.projectId).sort()).toEqual([a.summary.projectId, b.summary.projectId].sort());
    });

    test('an icon dropped into .ruimte is announced as a summary, and setIcon writes and removes the file', async () => {
        const opened = await store.openProject({ folder });
        expect(opened.summary.icon).toEqual({ kind: 'initial', value: 'R' });
        expect(opened.summary.nameSource).toBe('folder');

        // Opening also publishes a summary; wait for the icon reload's event.
        const summary = new Promise<SessionEvent>((resolve) => {
            store.subscribe('icon-listener', (event) => {
                if (
                    event.event === 'project.summary' &&
                    event.payload.summary.projectId === opened.summary.projectId &&
                    event.payload.summary.icon.kind === 'image' &&
                    event.payload.summary.icon.value === '.ruimte/icon.png'
                ) {
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

        const heic = await readFile(new URL('../../../ios/Tests/Fixtures/Files/image.heic', import.meta.url));
        const photo = await store.setIcon({ projectId: opened.summary.projectId, image: { mime: 'image/heic', base64: heic.toString('base64') } });

        expect(photo.icon).toMatchObject({ kind: 'image', value: '.ruimte/icon.heic' });
        expect(await readFile(join(folder, '.ruimte', 'icon.heic'))).toEqual(heic);
        await expect(readFile(join(folder, '.ruimte', 'icon.png'))).rejects.toMatchObject({ code: 'ENOENT' });
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
        const onDisk = await documentOnDisk(folder);
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
        expect(opened.document).toMatchObject({ version: PROJECT_VERSION, rev: 11, name: 'ruimte' });
        expect(opened.document.views).toHaveLength(1);
        expect(canvas(opened.document)).toMatchObject({ id: 'main', name: 'Canvas' });
        expect(canvas(opened.document).nodes[0]?.cwd).toBe(join(folder, 'apps'));
        /* Opening splits the folder: the views of a file nobody committed become this person's own,
           so the shared file keeps the identity and the private file everything else. */
        expect(await readFile(documentPathInFolder(folder), 'utf8')).toContain(`"version": ${PROJECT_VERSION}`);
        expect((await privateFileOnDisk(folder)).views).toHaveLength(1);
        expect(opened.document.shared).toEqual([]);

        await store.save(opened.summary.projectId, 11, { ...content(), views: opened.document.views });
        const onDisk = await documentOnDisk(folder);
        expect(onDisk).toMatchObject({ version: PROJECT_VERSION, rev: 12 });
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
        await summarySent();
        summaries.length = 0;

        await store.closeProject(projectId, 'c1');
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

    test('a folder opened for the first time is told to every client, so another window lists it', async () => {
        const opened = await store.openProject({ folder });
        await summarySent();
        expect(summaries.at(-1)).toMatchObject({ event: 'project.summary', payload: { summary: { projectId: opened.summary.projectId, closedAt: null } } });
    });

    test('a project that is closed while it is open is let go of as well', async () => {
        const { summary } = await store.openProject({ folder });
        await store.closeProject(summary.projectId, 'c1');
        expect(store.openProjectIds()).toEqual([]);
        // Nothing was saved or removed, so the canvas is still where it was.
        expect(await readFile(documentPathInFolder(folder), 'utf8')).toContain(`"version": ${PROJECT_VERSION}`);
    });

    test('closing survives a restart, because the registry carries it and not the client', async () => {
        const { summary } = await store.openProject({ folder });
        await store.closeProject(summary.projectId, 'c1');
        const restarted = new ProjectStore(home, projectLinks(), fake);
        expect((await restarted.list())[0]?.closedAt).toBeNumber();
    });

    test('a project another client still holds keeps its place, its watcher and its sessions', async () => {
        const ended: string[] = [];
        links.endSession = async (kind, nodeId) => {
            ended.push(`${kind}:${nodeId}`);
        };
        const { summary } = await store.openProject({ folder });
        store.hold('c1', summary.projectId);
        store.hold('c2', summary.projectId);
        await summarySent();
        summaries.length = 0;

        expect(await store.closeProject(summary.projectId, 'c1')).toEqual({ ended: 0, otherClients: 1 });
        expect(ended).toEqual([]);
        expect(store.openProjectIds()).toEqual([summary.projectId]);
        expect((await store.list())[0]?.closedAt).toBeNull();
        expect(summaries).toEqual([]);
    });

    test('the last client out ends the sessions the project holds', async () => {
        const ended: string[] = [];
        links.endSession = async (kind, nodeId) => {
            ended.push(`${kind}:${nodeId}`);
        };
        const opened = await store.openProject({ folder });
        const { projectId } = opened.summary;
        await store.save(projectId, opened.document.rev, content());
        store.hold('c1', projectId);

        expect(await store.closeProject(projectId, 'c1')).toEqual({ ended: 1, otherClients: 0 });
        expect(ended).toEqual(['terminal:n1']);
        expect((await store.list())[0]?.closedAt).toBeNumber();
    });

    test('a client that opens the project while its sessions end keeps it open, out of Recent', async () => {
        const opened = await store.openProject({ folder });
        const { projectId } = opened.summary;
        const two = content();
        canvas(two).nodes.push({ id: 'n2', kind: 'terminal', title: 'Shell', x: 0, y: 0, w: 10, h: 10 });
        await store.save(projectId, opened.document.rev, two);
        store.hold('c1', projectId);
        const ended: string[] = [];
        links.endSession = async (_kind, nodeId) => {
            ended.push(nodeId);
            if (ended.length === 1) {
                await store.openProject({ projectId });
                store.hold('c2', projectId);
            }
        };

        expect(await store.closeProject(projectId, 'c1')).toEqual({ ended: 1, otherClients: 1 });
        expect(ended).toEqual(['n1']);
        expect(store.openProjectIds()).toEqual([projectId]);
        expect((await store.list())[0]?.closedAt).toBeNull();
        expect(await store.save(projectId, 1, two)).toBe(2);
    });

    test('an open that lands before its client holds the project still keeps it open', async () => {
        const opened = await store.openProject({ folder });
        const { projectId } = opened.summary;
        await store.save(projectId, opened.document.rev, content());
        store.hold('c1', projectId);
        links.endSession = async () => {
            await store.openProject({ projectId });
        };

        await store.closeProject(projectId, 'c1');
        expect(store.openProjectIds()).toEqual([projectId]);
        expect((await store.list())[0]?.closedAt).toBeNull();
    });

    test('launches start with the first hold, are counted before closing, and end with the last client out', async () => {
        const calls: string[] = [];
        let running = 2;
        links.launches = {
            opened: (id) => calls.push(`opened:${id}`),
            running: () => running,
            end: async (id) => {
                calls.push(`end:${id}`);
                const ended = running;
                running = 0;
                return ended;
            }
        };
        const opened = await store.openProject({ folder });
        const { projectId } = opened.summary;
        await store.save(projectId, opened.document.rev, content());
        store.hold('c1', projectId);
        expect(store.closing('c1', projectId)).toEqual({ sessions: 3, otherClients: 0 });
        expect(await store.closeProject(projectId, 'c1')).toEqual({ ended: 3, otherClients: 0 });
        expect(calls).toEqual([`opened:${projectId}`, `end:${projectId}`]);
    });

    test('the language servers of a project end with the last client out and stay while another has it open', async () => {
        const ended: string[] = [];
        links.language = { end: async (id) => void ended.push(id) };
        const opened = await store.openProject({ folder });
        const { projectId } = opened.summary;
        await store.save(projectId, opened.document.rev, content());
        store.hold('c1', projectId);
        store.hold('c2', projectId);
        expect(store.holdersOf(projectId).sort()).toEqual(['c1', 'c2']);
        await store.closeProject(projectId, 'c1');
        expect(ended).toEqual([]);
        await store.closeProject(projectId, 'c2');
        expect(ended).toEqual([projectId]);
        expect(store.holdersOf(projectId)).toEqual([]);
    });

    test('what closing would do counts the sessions, or counts the clients that keep them running', async () => {
        const opened = await store.openProject({ folder });
        const { projectId } = opened.summary;
        await store.save(projectId, opened.document.rev, content());
        store.hold('c1', projectId);
        expect(store.closing('c1', projectId)).toEqual({ sessions: 1, otherClients: 0 });

        store.hold('c2', projectId);
        expect(store.closing('c1', projectId)).toEqual({ sessions: 0, otherClients: 1 });
    });

    test('a socket that goes lets the project go and leaves the list where it was', async () => {
        const { summary } = await store.openProject({ folder });
        const other = store.subscribe('c2', () => undefined);
        store.hold('c2', summary.projectId);
        await summarySent();
        summaries.length = 0;

        other();
        expect(store.openProjectIds()).toEqual([]);
        expect((await store.list())[0]?.closedAt).toBeNull();
        expect(summaries).toEqual([]);
    });

    test('letting go of a project leaves the list where it was', async () => {
        const { summary } = await store.openProject({ folder });
        await summarySent();
        summaries.length = 0;
        store.release(summary.projectId);
        expect(store.openProjectIds()).toEqual([]);
        expect((await store.list())[0]?.closedAt).toBeNull();
        expect(summaries).toEqual([]);
    });

    test('closing a project nobody knows is refused', async () => {
        await expect(store.closeProject('nope', 'c1')).rejects.toMatchObject({ code: 'project-not-found' });
    });

    describe('two copies of one canvas', () => {
        /* A second checkout of the same repository: the committed canvas, and with it the node ids. */
        const secondCheckout = async (): Promise<string> => {
            const other = join(root, 'repo-2');
            await mkdir(join(other, '.ruimte'), { recursive: true });
            await writeFile(documentPathInFolder(other), await readFile(documentPathInFolder(folder), 'utf8'));
            return other;
        };

        test('the second is refused while the first is open, so it never reaches the sessions of the first', async () => {
            const ended: string[] = [];
            links.endSession = async (_kind, nodeId) => {
                ended.push(nodeId);
            };
            links.tracked = async () => true;
            const first = await store.openProject({ folder });
            await store.save(first.summary.projectId, 0, content(), ['main']);
            store.hold('c1', first.summary.projectId);
            const other = await secondCheckout();

            await expect(store.openProject({ folder: other })).rejects.toMatchObject({ code: 'project-ids-taken' });
            expect(store.index.locate('n1')?.projectId).toBe(first.summary.projectId);
            expect(ended).toEqual([]);
            // Nothing of the refused folder was written down: no registry entry, no private file.
            expect((await store.list()).map((summary) => summary.folder)).toEqual([folder]);
        });

        test('it opens once the first is closed, and the first is refused in turn', async () => {
            links.tracked = async () => true;
            const first = await store.openProject({ folder });
            await store.save(first.summary.projectId, 0, content(), ['main']);
            const other = await secondCheckout();
            await store.closeProject(first.summary.projectId, 'c1');

            const second = await store.openProject({ folder: other });
            expect(second.document.views.map((view) => view.id)).toEqual(['main']);
            await expect(store.openProject({ projectId: first.summary.projectId })).rejects.toMatchObject({ code: 'project-ids-taken' });
        });
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
        expect(await readFile(documentPathInFolder(deep), 'utf8')).toContain(`"version": ${PROJECT_VERSION}`);
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
        await store.closeProject(projectId, 'c1');
        expect(store.index.locate('agent')).toEqual({ projectId, folder, canvasId: 'main' });

        await store.delete(projectId, false);
        expect(store.index.sourcesFor('agent')).toEqual([]);
    });

    test('warming reads a project nobody opened since the daemon started', async () => {
        const opened = await store.openProject({ folder });
        await store.save(opened.summary.projectId, 0, linked('from disk'));
        await store.closeProject(opened.summary.projectId, 'c1');

        const restarted = new ProjectStore(home, projectLinks(), fake);
        expect(restarted.index.sourcesFor('agent')).toEqual([]);
        await restarted.warmIndex();
        expect(restarted.index.sourcesFor('agent')[0]).toMatchObject({ text: 'from disk' });
        expect(restarted.openProjectIds()).toEqual([]);
    });

    test('warming skips a project whose file is gone or will not parse, and starts anyway', async () => {
        const opened = await store.openProject({ folder });
        await store.save(opened.summary.projectId, 0, linked('x'));
        await writeFile(documentPathInFolder(folder), '{ not json');

        const restarted = new ProjectStore(home, projectLinks(), fake);
        await restarted.warmIndex();
        expect(restarted.index.has(opened.summary.projectId)).toBe(false);
        // Nobody asked for that file, so it is not set aside the way an open would.
        expect(await readFile(documentPathInFolder(folder), 'utf8')).toBe('{ not json');
    });
});

describe('portable paths', () => {
    const REPO = resolve('/repo');

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
                            { id: 'a', kind: 'terminal', title: '', x: 0, y: 0, w: 1, h: 1, cwd: join(REPO, 'apps') },
                            { id: 'b', kind: 'terminal', title: '', x: 0, y: 0, w: 1, h: 1, cwd: REPO },
                            { id: 'c', kind: 'terminal', title: '', x: 0, y: 0, w: 1, h: 1, cwd: '/elsewhere' },
                            { id: 'd', kind: 'chat', title: '', x: 0, y: 0, w: 1, h: 1 },
                            { id: 'f', kind: 'terminal', title: '', x: 0, y: 0, w: 1, h: 1, cwd: join(REPO, '..cache') }
                        ],
                        texts: [],
                        edges: [],
                        layouts: []
                    },
                    { kind: 'terminal', id: 'e', name: 'deploy', node: { cwd: join(REPO, 'apps', 'server') } }
                ]
            },
            REPO
        );
        expect(canvas(portable).nodes.map((node) => node.cwd)).toEqual(['./apps', '.', '/elsewhere', undefined, './..cache']);
        // A standalone view carries a folder too, and travels the same way.
        expect(portable.views[1]).toMatchObject({ node: { cwd: './apps/server' } });
        const back = fromPortable(portable, REPO);
        expect(canvas(back).nodes.map((node) => node.cwd)).toEqual([join(REPO, 'apps'), REPO, '/elsewhere', undefined, join(REPO, '..cache')]);
        expect(back.views[1]).toMatchObject({ node: { cwd: join(REPO, 'apps', 'server') } });
    });

    test('a relative folder that climbs out of the project is dropped on the way in', () => {
        const back = fromPortable(
            {
                name: 'x',
                color: '',
                views: [
                    {
                        kind: 'canvas',
                        id: 'main',
                        name: 'Canvas',
                        nodes: [
                            { id: 'a', kind: 'terminal', title: '', x: 0, y: 0, w: 1, h: 1, cwd: '../../etc' },
                            { id: 'b', kind: 'terminal', title: '', x: 0, y: 0, w: 1, h: 1, cwd: './apps/../server' }
                        ],
                        texts: [],
                        edges: [],
                        layouts: []
                    }
                ]
            },
            REPO
        );
        expect(canvas(back).nodes[0]).not.toHaveProperty('cwd');
        expect(canvas(back).nodes[1]!.cwd).toBe(join(REPO, 'server'));
    });
});

describe('mutate', () => {
    test('writes a released project to disk, tells every sink, and updates the index', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        store.hold('c1', projectId);
        await store.save(projectId, opened.document.rev, content());
        store.release(projectId);
        changed = [];

        expect(await store.mutate(projectId, addNote('note-1'))).toBe('note-1');

        const onDisk = await documentOnDisk(folder);
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

    test('a client without the project hears the change as its sidebar rows, never as the document', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        store.hold('c1', projectId);
        const heard: { event: string; payload: unknown }[] = [];
        const off = store.subscribe('c2', (event) => heard.push(event));
        changed = [];

        await store.mutate(projectId, addNote('note-1'));

        off();
        expect(changed.map((event) => event.event)).toEqual(['project.changed']);
        // A summary the open published may land here too; only the one with rows answers the write.
        expect(heard.map((event) => event.event)).not.toContain('project.changed');
        expect(heard.filter((event) => 'views' in (event.payload as object))).toEqual([
            {
                event: 'project.summary',
                payload: { summary: expect.objectContaining({ projectId }), views: [expect.objectContaining({ id: 'main', kind: 'canvas', nodes: [] })] }
            }
        ]);
    });

    test('an open project takes the new rev, so the next save and the watcher agree with it', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        store.hold('c1', projectId);
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
        expect((await privateFileOnDisk(folder)).rev).toBe(opened.document.rev);
        expect(changed).toEqual([]);
    });

    test('landed runs after the write and before the event, and never for a refused change', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        store.hold('c1', projectId);
        store.release(projectId);
        changed = [];
        const seen: Array<{ rev: number; events: number }> = [];
        const landed = async () => {
            const onDisk = await documentOnDisk(folder);
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

describe('the two files of a project', () => {
    const sharedText = (): Promise<string> => readFile(documentPathInFolder(folder), 'utf8');

    const gitignore = (): Promise<string> => readFile(join(folder, '.ruimte', '.gitignore'), 'utf8');

    test('opening writes a gitignore that keeps the private half out of the repository, and leaves an edited one alone', async () => {
        await store.openProject({ folder });
        expect(await gitignore()).toBe(GITIGNORE_TEXT);
        expect(GITIGNORE_TEXT).toContain('private/');

        await writeFile(join(folder, '.ruimte', '.gitignore'), 'private/\n# mine\n');
        store.closeAll();
        await store.openProject({ folder });
        expect(await gitignore()).toBe('private/\n# mine\n');
    });

    test('nothing is shared until a save says so, and then only that view travels', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        expect(opened.document.shared).toEqual([]);
        expect(await sharedText()).not.toContain('"main"');

        expect(await store.save(projectId, 0, content(), ['main'])).toBe(1);
        expect(await sharedText()).toContain('"main"');
        expect((await privateFileOnDisk(folder)).views).toEqual([]);
        expect((await documentOnDisk(folder)).shared).toEqual(['main']);

        // And back: the view returns to the private file and the shared one keeps only the identity.
        expect(await store.save(projectId, 1, content(), [])).toBe(2);
        expect(await sharedText()).not.toContain('"main"');
        expect((await privateFileOnDisk(folder)).views).toHaveLength(1);
    });

    test('a session, a mode and a worktree stay behind when a canvas travels, and are laid back on the way in', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        const withSession = content();
        canvas(withSession).nodes[0] = {
            ...canvas(withSession).nodes[0]!,
            resume: 'sess-1',
            runtimeMode: 'auto',
            worktree: { path: join(home, 'worktrees', 'x'), branch: 'feat' }
        };
        await store.save(projectId, 0, withSession, ['main']);

        const shared = JSON.parse(await sharedText()) as { views: { nodes: Record<string, unknown>[] }[] };
        const node = shared.views[0]!.nodes[0]!;
        expect(node.resume).toBeUndefined();
        expect(node.runtimeMode).toBeUndefined();
        expect(node.worktree).toBeUndefined();
        expect(node.title).toBe('shell');
        expect((await privateFileOnDisk(folder)).overlay.n1).toMatchObject({ resume: 'sess-1', runtimeMode: 'auto' });

        // Reading the folder again puts the node back together.
        store.closeAll();
        const again = await store.openProject({ folder });
        expect(canvas(again.document).nodes[0]).toMatchObject({ resume: 'sess-1', runtimeMode: 'auto' });
        expect(again.document.shared).toEqual(['main']);
    });

    test('a save that changes nothing shared leaves that file untouched, so git sees no change', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        await store.save(projectId, 0, content(), ['main']);
        const before = await sharedText();

        // A private view moves; the shared file has no business changing for it.
        const moved = content();
        moved.views = [...moved.views, { kind: 'canvas', id: 'mine', name: 'Mine', nodes: [], texts: [], edges: [], layouts: [] }];
        await store.save(projectId, 1, moved, ['main']);
        expect(await sharedText()).toBe(before);
        expect((await privateFileOnDisk(folder)).views.map((view) => view.id)).toEqual(['mine']);
    });

    test('a session naming a shared node leaves the shared file untouched, and the name comes back on the way in', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        const named = (title: string): ProjectContent => {
            const next = content();
            canvas(next).nodes[0] = { ...canvas(next).nodes[0]!, title, titleSource: 'auto' };
            return next;
        };
        await store.save(projectId, 0, named('First prompt'), ['main']);
        const before = await sharedText();

        await store.save(projectId, 1, named('What the CLI called it'), ['main']);
        expect(await sharedText()).toBe(before);

        store.closeAll();
        const again = await store.openProject({ folder });
        expect(canvas(again.document).nodes[0]).toMatchObject({ title: 'What the CLI called it', titleSource: 'auto' });
    });

    test('a version-2 file git tracks was shared on purpose and stays that way', async () => {
        await mkdir(join(folder, '.ruimte'));
        const legacy = { version: 2, rev: 5, name: 'repo', color: '#123456', views: content().views };
        await writeFile(documentPathInFolder(folder), JSON.stringify(legacy));
        links.tracked = async () => true;

        const opened = await store.openProject({ folder });
        expect(opened.document.shared).toEqual(['main']);
        expect(await sharedText()).toContain('"main"');
        expect((await privateFileOnDisk(folder)).views).toEqual([]);
        // The folder it named is this machine's, so it waits in the overlay all the same.
        expect((await privateFileOnDisk(folder)).overlay).toEqual({});
    });

    test('a node an agent adds to a shared canvas travels with it, and a verb never moves a view between the files', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        await store.save(projectId, 0, content(), ['main']);

        await store.mutate(projectId, (current) => {
            const view = current.views[0] as ProjectCanvasView;
            return {
                content: {
                    ...current,
                    views: [{ ...view, nodes: [...view.nodes, { id: 'n2', kind: 'note', title: 'by an agent', x: 0, y: 0, w: 10, h: 10 }] }]
                },
                result: null
            };
        });

        expect(await sharedText()).toContain('by an agent');
        expect((await documentOnDisk(folder)).shared).toEqual(['main']);
    });
});

describe('what the shared file may decide', () => {
    const sharedPath = (): string => documentPathInFolder(folder);

    /* The shared file as a pull or an agent with a shell would leave it: the same file, one node changed by hand. */
    const editShared = async (edit: (node: Record<string, unknown>) => Record<string, unknown>): Promise<void> => {
        const file = JSON.parse(await readFile(sharedPath(), 'utf8')) as { views: { nodes: Record<string, unknown>[] }[] };
        const view = file.views[0]!;
        view.nodes = [edit(view.nodes[0]!), ...view.nodes.slice(1)];
        await writeFile(sharedPath(), JSON.stringify(file, null, 2));
    };

    test('a mode, a session and a folder off the disk in the shared file are never handed on', async () => {
        const opened = await store.openProject({ folder });
        await store.save(opened.summary.projectId, 0, content(), ['main']);
        await editShared((node) => ({ ...node, runtimeMode: 'full-access', resume: 'theirs', cwd: '/' }));
        store.closeAll();

        const again = await store.openProject({ folder });
        const node = canvas(again.document).nodes[0]!;
        expect(node).not.toHaveProperty('runtimeMode');
        expect(node).not.toHaveProperty('resume');
        expect(node).not.toHaveProperty('cwd');
        // An agent reads the same document, so a verb never sees them either.
        expect(canvas(await store.read(opened.summary.projectId)).nodes[0]).not.toHaveProperty('runtimeMode');
    });

    test('a folder that climbs out of the project is dropped, and the overlay of this person still applies', async () => {
        const opened = await store.openProject({ folder });
        const mine = content();
        canvas(mine).nodes[0] = { ...canvas(mine).nodes[0]!, runtimeMode: 'auto' };
        await store.save(opened.summary.projectId, 0, mine, ['main']);
        await editShared((node) => ({ ...node, cwd: '../../..' }));
        store.closeAll();

        const node = canvas((await store.openProject({ folder })).document).nodes[0]!;
        expect(node).not.toHaveProperty('cwd');
        expect(node.runtimeMode).toBe('auto');
    });

    test('a version-2 file git tracks moves what belonged to this person into the overlay', async () => {
        await mkdir(join(folder, '.ruimte'));
        const views = content().views as ProjectCanvasView[];
        const node = { ...views[0]!.nodes[0]!, cwd: '/elsewhere', resume: 'sess-1', runtimeMode: 'auto' as const };
        await writeFile(
            documentPathInFolder(folder),
            JSON.stringify({ version: 2, rev: 5, name: 'repo', color: '#123456', views: [{ ...views[0]!, nodes: [node] }] })
        );
        links.tracked = async () => true;

        const opened = await store.openProject({ folder });
        expect(canvas(opened.document).nodes[0]).toMatchObject({ cwd: '/elsewhere', resume: 'sess-1', runtimeMode: 'auto' });
        expect((await privateFileOnDisk(folder)).overlay.n1).toEqual({ cwd: '/elsewhere', resume: 'sess-1', runtimeMode: 'auto' });
        expect(await readFile(sharedPath(), 'utf8')).not.toContain('sess-1');
    });

    test("a version-2 file the repository tracks keeps a file view off the folder as this person's own", async () => {
        await mkdir(join(folder, '.ruimte'));
        const views = [...content().views, { kind: 'file', id: 'f1', name: 'notes', path: '/home/bas/notes.md' }];
        await writeFile(documentPathInFolder(folder), JSON.stringify({ version: 2, rev: 5, name: 'repo', color: '#123456', views }));
        links.tracked = async () => true;

        const opened = await store.openProject({ folder });
        expect(opened.document.views.map((view) => view.id)).toEqual(['main', 'f1']);
        expect(opened.document.shared).toEqual(['main']);
        expect((await privateFileOnDisk(folder)).views.map((view) => view.id)).toEqual(['f1']);
        expect(await readFile(sharedPath(), 'utf8')).not.toContain('notes.md');
    });

    test('a version-2 file that turns up after the split came from a colleague, and keeps nothing of theirs', async () => {
        links.tracked = async () => true;
        const opened = await store.openProject({ folder });
        await store.save(opened.summary.projectId, 0, content(), ['main']);
        store.closeAll();
        const views = content().views as ProjectCanvasView[];
        const node = { ...views[0]!.nodes[0]!, resume: 'theirs', runtimeMode: 'full-access' as const };
        await writeFile(sharedPath(), JSON.stringify({ version: 2, rev: 9, name: 'repo', color: '#123456', views: [{ ...views[0]!, nodes: [node] }] }));

        const again = await store.openProject({ folder });
        expect(canvas(again.document).nodes[0]).not.toHaveProperty('resume');
        expect(canvas(again.document).nodes[0]).not.toHaveProperty('runtimeMode');
    });

    /* This person's canvas after the split: a shared view with a mode and a session of theirs, and a view of their own. */
    const splitMine = async (): Promise<string> => {
        links.tracked = async () => true;
        const opened = await store.openProject({ folder });
        store.hold('c1', opened.summary.projectId);
        const mine = content();
        canvas(mine).nodes[0] = { ...canvas(mine).nodes[0]!, runtimeMode: 'auto', resume: 'sess-mine' };
        mine.views = [...mine.views, { kind: 'canvas', id: 'mine', name: 'Mine', nodes: [], texts: [], edges: [], layouts: [] }];
        await store.save(opened.summary.projectId, 0, mine, ['main']);
        return opened.summary.projectId;
    };

    const colleagueFile = (): string => JSON.stringify({ version: 2, rev: 9, name: 'repo', color: '#123456', views: [content().views[0]] });

    test('a version-2 file pulled after the split keeps the private views, the overlay and the rev of this machine', async () => {
        await splitMine();
        store.closeAll();
        await writeFile(sharedPath(), colleagueFile());

        const again = await store.openProject({ folder });
        expect(again.document.views.map((view) => view.id)).toEqual(['main', 'mine']);
        expect(canvas(again.document).nodes[0]).toMatchObject({ runtimeMode: 'auto', resume: 'sess-mine' });
        expect(again.document.rev).toBe(1);
        expect((await privateFileOnDisk(folder)).views.map((view) => view.id)).toEqual(['mine']);
        expect((await privateFileOnDisk(folder)).overlay.n1).toMatchObject({ runtimeMode: 'auto', resume: 'sess-mine' });
    });

    test('a version-2 file the watcher sees land keeps the private views too', async () => {
        await splitMine();
        await writeFile(sharedPath(), colleagueFile());
        projectDirWatcher().emit('project.json');
        await fake.settle();

        expect(changed.at(-1)).toMatchObject({ event: 'project.changed', payload: { document: { views: [{ id: 'main' }, { id: 'mine' }] } } });
        expect((await privateFileOnDisk(folder)).views.map((view) => view.id)).toEqual(['mine']);
        expect((await privateFileOnDisk(folder)).overlay.n1).toMatchObject({ runtimeMode: 'auto', resume: 'sess-mine' });
    });
});

describe('saves and outside edits', () => {
    test('after a pull, a node an agent adds is not lost to an autosave based on the pull', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        store.hold('c1', projectId);
        await store.save(projectId, 0, content(), ['main'], 'c1');

        await pull('from git');
        projectDirWatcher().emit('project.json');
        await fake.settle();
        expect(changed.at(-1)).toMatchObject({ payload: { document: { rev: 2, name: 'from git' } } });
        // The bump is on disk too, which is where a verb reads the rev.
        expect((await privateFileOnDisk(folder)).rev).toBe(2);
        expect(await store.revision(projectId)).toBe(2);

        await store.mutate(projectId, addNote('by-agent'));
        expect(changed.at(-1)).toMatchObject({ payload: { document: { rev: 3 } } });

        // The client autosaves the screen it had after the pull, which has no agent node yet.
        await expect(store.save(projectId, 2, content('from git'), ['main'], 'c1')).rejects.toMatchObject({ code: 'rev-conflict' });
        expect(canvas(await documentOnDisk(folder)).nodes.map((node) => node.id)).toEqual(['n1', 'by-agent']);
    });

    test('a save right after an outside edit is refused, and the edit is taken in for every client', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        store.hold('c1', projectId);
        await store.save(projectId, 0, content(), ['main'], 'c1');

        // Pulled, but the watcher has not settled yet.
        await pull('from git');
        projectDirWatcher().emit('project.json');
        await expect(store.save(projectId, 1, content(), ['main'], 'c1')).rejects.toMatchObject({ code: 'rev-conflict' });
        expect(changed).toHaveLength(1);
        // The sender hears it too, since that is what it has to save against.
        expect(changed[0]).toMatchObject({ event: 'project.changed', payload: { document: { rev: 2, name: 'from git' } } });
        expect((await documentOnDisk(folder)).name).toBe('from git');

        // The watcher arrives late and finds nothing it has not seen.
        await fake.settle();
        expect(changed).toHaveLength(1);
        expect(await store.save(projectId, 2, content('from git'), ['main'], 'c1')).toBe(3);
    });

    test('a save over a shared file that is broken right now writes nothing', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        await store.save(projectId, 0, content(), ['main']);
        changed = [];
        await writeFile(documentPathInFolder(folder), '{ "version": 3, "na');

        await expect(store.save(projectId, 1, content('mine'))).rejects.toMatchObject({ code: 'rev-conflict' });
        expect(await readFile(documentPathInFolder(folder), 'utf8')).toBe('{ "version": 3, "na');
        expect(changed).toEqual([]);
    });

    test('a save that gives two things one id is refused and writes nothing', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        const twice = content();
        canvas(twice).nodes.push({ ...canvas(twice).nodes[0]!, title: 'again' });

        await expect(store.save(projectId, 0, twice)).rejects.toMatchObject({ code: 'project-invalid', message: expect.stringContaining('"n1"') });
        expect((await documentOnDisk(folder)).views).toEqual([]);
        expect(await store.save(projectId, 0, content())).toBe(1);
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

    /* The entries this daemon does not know, the way they stand in the files right now. Opening a
       version-2 file nobody committed moves its views to the private one, which is where they sit. */
    const unknownOnDisk = async (): Promise<string> => {
        const views = (await rawPrivateViews(folder)) as Array<{ id: string; nodes?: unknown[] }>;
        return JSON.stringify([
            views.find((view) => view.id === 'main')!.nodes!.find((node) => (node as { id: string }).id === 'holo'),
            views.find((view) => view.id === 'timeline-1')
        ]);
    };

    const UNKNOWN = JSON.stringify([HOLOGRAM, TIMELINE]);

    beforeEach(async () => {
        await mkdir(join(folder, '.ruimte'), { recursive: true });
        await writeFile(documentPathInFolder(folder), newerFile());
    });

    test('opening such a file sets nothing aside and hands the entries on', async () => {
        const opened = await store.openProject({ folder });
        expect((await readdir(join(folder, '.ruimte'))).sort()).toEqual(['.gitignore', 'private', 'project.json']);
        expect(await unknownOnDisk()).toBe(UNKNOWN);
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
        links.viewFiles = () => [drawings, diagrams];
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

    test('a mutation that removes a drawing and a diagram takes their files on both sides of a released project, and leaves the unknown view and the live ones alone', async () => {
        const drawingFiles = new DrawingStore(store, fake);
        const diagramFiles = new DiagramStore(store, fake);
        links.viewFiles = () => [drawingFiles, diagramFiles];
        const opened = await store.openProject({ folder });
        const { projectId } = opened.summary;
        store.hold('c1', projectId);
        const { version: _version, rev, ...sent } = opened.document;
        const views = [...sent.views, { kind: 'drawing' as const, id: 'kept', name: 'Kept' }];
        await store.save(projectId, rev, { ...sent, views }, ['main', 'sketch', 'kept']);
        for (const side of [join(folder, '.ruimte'), join(folder, '.ruimte', 'private')]) {
            for (const dir of ['drawings', 'diagrams']) {
                await mkdir(join(side, dir), { recursive: true });
                for (const viewId of ['timeline-1', 'sketch', 'chart', 'kept']) {
                    await writeFile(join(side, dir, `${viewId}.json`), '{}');
                }
            }
        }
        store.release(projectId);
        changed = [];

        await store.mutate(projectId, (current) => ({
            content: { ...current, views: current.views.filter((view) => view.id !== 'sketch' && view.id !== 'chart') },
            result: null
        }));

        for (const side of [join(folder, '.ruimte'), join(folder, '.ruimte', 'private')]) {
            expect((await readdir(join(side, 'drawings'))).sort()).toEqual(['kept.json', 'timeline-1.json']);
            expect(await readdir(join(side, 'diagrams'))).toEqual(['timeline-1.json']);
        }
        expect(store.index.viewsOf(projectId)?.map((view) => view.id)).toEqual(['main', 'timeline-1', 'kept']);
        expect(changed.map((event) => event.event)).toEqual(['project.changed']);
    });

    test('a mutation that keeps every drawing and diagram removes no file, not even one without a view', async () => {
        const drawingFiles = new DrawingStore(store, fake);
        const diagramFiles = new DiagramStore(store, fake);
        links.viewFiles = () => [drawingFiles, diagramFiles];
        const { projectId } = (await store.openProject({ folder })).summary;
        await mkdir(join(folder, '.ruimte', 'drawings'), { recursive: true });
        await writeFile(join(folder, '.ruimte', 'drawings', 'arriving.json'), '{}');

        await store.mutate(projectId, (current) => ({ content: { ...current, name: 'renamed' }, result: null }));

        expect(await readdir(join(folder, '.ruimte', 'drawings'))).toEqual(['arriving.json']);
    });
});

describe('fields this version does not know', () => {
    const FILE_NODE = { id: 'f1', kind: 'file', title: 'a.ts', x: 0, y: 0, w: 320, h: 200, path: 'a.ts', location: { line: 3 } };
    const NOTE = { id: 'n2', kind: 'note', title: 'Note', x: 0, y: 300, w: 320, h: 240, body: 'hi' };
    const CHAT = { id: 'c1', kind: 'chat', title: 'Chat', x: 400, y: 0, w: 480, h: 360 };

    const canvasView = (nodes: unknown[], extra: Record<string, unknown> = {}) => ({
        kind: 'canvas',
        id: 'main',
        name: 'Canvas',
        nodes,
        texts: [],
        edges: [],
        layouts: [],
        ...extra
    });

    const sharedText = (): Promise<string> => readFile(documentPathInFolder(folder), 'utf8');

    /* Both files as a newer Ruimte left them, read by a store that opens the project fresh. */
    async function seed(shared: unknown[], own: { views?: unknown[]; overlay?: Record<string, unknown>; overlayFields?: string[] } = {}): Promise<string> {
        const { summary } = await store.openProject({ folder });
        store.closeAll();
        await writeFile(documentPathInFolder(folder), JSON.stringify({ version: PROJECT_VERSION, name: 'repo', color: '#123456', views: shared }, null, 2));
        const views = own.views ?? [];
        const privateFile = {
            version: 1,
            rev: 0,
            views,
            order: [...shared, ...views].map((view) => (view as { id: string }).id),
            overlay: own.overlay ?? {},
            ...(own.overlayFields ? { overlayFields: own.overlayFields } : {})
        };
        await writeFile(join(folder, '.ruimte', 'private', 'project.json'), JSON.stringify(privateFile, null, 2));
        return summary.projectId;
    }

    const privateText = (): Promise<string> => readFile(join(folder, '.ruimte', 'private', 'project.json'), 'utf8');

    const contentOf = (document: ProjectContent & { rev?: number }): ProjectContent => ({ name: document.name, color: document.color, views: document.views });

    test('a node of a shared canvas keeps its unknown key through open and save, and the shared text stays put', async () => {
        const projectId = await seed([canvasView([FILE_NODE, NOTE], { futureView: 1 })]);
        const opened = await store.openProject({ projectId });
        expect(canvas(opened.document).nodes[0]).toMatchObject({ location: { line: 3 } });

        expect(await store.save(projectId, 0, contentOf(opened.document), opened.document.shared)).toBe(1);
        const first = await sharedText();
        expect(first).toContain('"location"');
        expect(first).toContain('"futureView"');
        expect(await store.save(projectId, 1, contentOf(opened.document), opened.document.shared)).toBe(2);
        expect(await sharedText()).toBe(first);
    });

    test('a private view keeps them too', async () => {
        const projectId = await seed([], { views: [canvasView([FILE_NODE], { futureView: 1 })] });
        const opened = await store.openProject({ projectId });
        await store.save(projectId, 0, contentOf(opened.document), []);
        const views = await rawPrivateViews(folder);
        expect(views[0]).toMatchObject({ futureView: 1, nodes: [{ location: { line: 3 } }] });
    });

    test('a private field of a newer Ruimte stays in the overlay, out of the shared file, with its list', async () => {
        const projectId = await seed([canvasView([CHAT])], { overlay: { c1: { sandbox: 'B' } }, overlayFields: ['sandbox'] });
        const opened = await store.openProject({ projectId });
        expect(canvas(opened.document).nodes[0]).toMatchObject({ sandbox: 'B' });

        await store.save(projectId, 0, contentOf(opened.document), opened.document.shared);
        expect(await sharedText()).not.toContain('sandbox');
        const file = JSON.parse(await privateText()) as { overlay: Record<string, unknown>; overlayFields: string[] };
        expect(file.overlay.c1).toEqual({ sandbox: 'B' });
        expect(file.overlayFields).toEqual(['sandbox']);
    });

    test('a shared view of a kind this daemon does not know keeps its overlay entry through a save', async () => {
        const gallery = { kind: 'gallery', id: 'gallery-1', name: 'Gallery', node: { title: 'Gallery' } };
        const projectId = await seed([canvasView([CHAT]), gallery], { overlay: { 'gallery-1': { picture: 'pic-1' } } });
        const opened = await store.openProject({ projectId });
        expect(opened.document.views.map((view) => view.kind)).toEqual(['canvas', 'unknown']);

        await store.save(projectId, 0, contentOf(opened.document), opened.document.shared);
        expect(await sharedText()).not.toContain('pic-1');
        expect(JSON.parse(await privateText()).overlay['gallery-1']).toEqual({ picture: 'pic-1' });
    });

    test('a duplicate of such a node under a new id keeps the field private as well', async () => {
        const projectId = await seed([canvasView([CHAT])], { overlay: { c1: { sandbox: 'B' } }, overlayFields: ['sandbox'] });
        const opened = await store.openProject({ projectId });
        const document = contentOf(opened.document);
        const view = canvas(document);
        canvas(document).nodes.push({ ...view.nodes[0]!, id: 'c2' });
        await store.save(projectId, 0, document, opened.document.shared);
        expect(await sharedText()).not.toContain('sandbox');
        expect(JSON.parse(await privateText()).overlay.c2).toEqual({ sandbox: 'B' });
    });

    test('a stale save is refused and both files still hold the fields, and a save on the new rev keeps them', async () => {
        const projectId = await seed([canvasView([FILE_NODE, CHAT, NOTE])], { overlay: { c1: { sandbox: 'B' } }, overlayFields: ['sandbox'] });
        const opened = await store.openProject({ projectId });
        await store.mutate(projectId, (current) => {
            const view = current.views[0] as ProjectCanvasView;
            const renamed = view.nodes.map((node) => (node.id === 'n2' ? { ...node, title: 'Renamed' } : node));
            return { content: { ...current, views: [{ ...view, nodes: renamed }] }, result: null };
        });

        await expect(store.save(projectId, 0, contentOf(opened.document), opened.document.shared)).rejects.toMatchObject({ code: 'rev-conflict' });
        expect(await sharedText()).toContain('"location"');
        expect(JSON.parse(await privateText()).overlay.c1).toEqual({ sandbox: 'B' });

        const current = await store.read(projectId);
        expect(await store.save(projectId, await store.revision(projectId), current, opened.document.shared)).toBe(2);
        expect(await sharedText()).toContain('"location"');
        expect(await sharedText()).not.toContain('sandbox');
        expect(JSON.parse(await privateText()).overlay.c1).toEqual({ sandbox: 'B' });
    });

    test('a pull that brings a new unknown key keeps it, and leaves the overlay alone', async () => {
        const projectId = await seed([canvasView([FILE_NODE, CHAT])], { overlay: { c1: { sandbox: 'B' } }, overlayFields: ['sandbox'] });
        const opened = await store.openProject({ projectId });
        store.hold('c1', projectId);
        await store.save(projectId, 0, contentOf(opened.document), opened.document.shared, 'c1');

        const path = documentPathInFolder(folder);
        const pulled = JSON.parse(await readFile(path, 'utf8')) as { views: { nodes: Record<string, unknown>[] }[] };
        pulled.views[0]!.nodes[0]!.pinned = true;
        await writeFile(path, JSON.stringify(pulled, null, 2));
        projectDirWatcher().emit('project.json');
        await fake.settle();

        expect(changed.at(-1)).toMatchObject({ payload: { document: { rev: 2 } } });
        expect(canvas((await store.openProject({ projectId })).document).nodes[0]).toMatchObject({ location: { line: 3 }, pinned: true });
        const file = JSON.parse(await privateText()) as { rev: number; overlay: Record<string, unknown>; overlayFields: string[] };
        expect(file).toMatchObject({ rev: 2, overlay: { c1: { sandbox: 'B' } }, overlayFields: ['sandbox'] });
        expect(await sharedText()).not.toContain('sandbox');
    });
});

describe('the machine of a node', () => {
    const REMOTE_CWD = join('/', 'srv', 'elsewhere', 'work');

    function bound(machine?: string): ProjectContent {
        const base = content();
        const view = canvas(base);
        return { ...base, views: [{ ...view, nodes: [{ ...view.nodes[0]!, cwd: REMOTE_CWD, ...(machine ? { machine } : {}) }] }] };
    }

    /* Every file below the project's own folder and the home, the way a colleague or git would see them. */
    async function textOfProjectFiles(): Promise<string> {
        const names = (await readdir(join(folder, '.ruimte'), { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile());
        const texts = await Promise.all(names.map((entry) => readFile(join(entry.parentPath, entry.name), 'utf8')));
        return texts.join('\n');
    }

    async function openBound(): Promise<string> {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        store.hold('c1', projectId);
        await store.save(projectId, opened.document.rev, bound('machine-b'));
        return projectId;
    }

    test('is kept under the home, comes back on open, and reaches no project file', async () => {
        const projectId = await openBound();
        expect(store.remote.machineOf(projectId, 'n1')).toBe('machine-b');
        expect(await textOfProjectFiles()).not.toContain('"machine"');
        expect(JSON.parse(await readFile(join(home, 'remote', `${projectId}.json`), 'utf8'))).toMatchObject({ nodes: { n1: 'machine-b' } });

        const fresh = new ProjectStore(home, projectLinks(), new FakeWatch());
        await fresh.remote.load();
        expect(canvas((await fresh.openProject({ projectId })).document).nodes[0]).toMatchObject({ machine: 'machine-b' });
        fresh.closeAll();
    });

    test('is kept by a save that names none, and told to the other clients that hold the project', async () => {
        const projectId = await openBound();
        const heard: SessionEvent[] = [];
        const off = store.subscribe('c2', (event) => heard.push(event));
        store.hold('c2', projectId);
        await store.save(projectId, 1, bound(), undefined, 'c1');
        off();
        expect(store.remote.machineOf(projectId, 'n1')).toBe('machine-b');
        expect(heard.find((event) => event.event === 'project.changed')).toMatchObject({
            payload: { document: { views: [{ nodes: [{ id: 'n1', machine: 'machine-b' }] }] } }
        });
        expect(canvas(await store.read(projectId)).nodes[0]).not.toHaveProperty('machine');
        expect(canvas((await store.openProject({ projectId })).document).nodes[0]).toMatchObject({ machine: 'machine-b' });
    });

    test('is not bound by a save whose write failed', async () => {
        store.closeAll();
        let fail = false;
        let writes = 0;
        store = new ProjectStore(home, links, fake, {
            ...PROJECT_WRITE_IO,
            write: async (...args) => {
                if (fail) {
                    writes += 1;
                    throw new Error('disk full');
                }
                await PROJECT_WRITE_IO.write(...args);
            }
        });
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        fail = true;
        await expect(store.save(projectId, opened.document.rev, bound('machine-b'))).rejects.toThrow('disk full');
        expect(writes).toBe(1);
        expect(store.remote.machineOf(projectId, 'n1')).toBeNull();
        expect((await documentOnDisk(folder)).views).toEqual([]);
    });

    test('goes with its node', async () => {
        const projectId = await openBound();
        await store.save(projectId, 1, { ...content(), views: [{ ...canvas(content()), nodes: [] }] });
        expect(store.remote.machineOf(projectId, 'n1')).toBeNull();
        await store.save(projectId, 2, bound());
        expect(canvas((await store.openProject({ projectId })).document).nodes[0]).not.toHaveProperty('machine');
    });

    test('is set by no verb, which may still change the node it is on', async () => {
        const projectId = await openBound();
        await store.mutate(projectId, (current) => {
            const view = canvas(current);
            const added = { id: 'n2', kind: 'terminal' as const, title: 'new', x: 0, y: 400, w: 560, h: 360, machine: 'machine-c' };
            const renamed = { ...view.nodes[0]!, title: 'renamed' };
            return { content: { ...current, views: [{ ...view, nodes: [renamed, added] }] }, result: null };
        });
        expect(store.remote.nodesOf(projectId)).toEqual({ n1: 'machine-b' });
        const nodes = canvas((await store.openProject({ projectId })).document).nodes;
        expect(nodes[0]).toMatchObject({ title: 'renamed', machine: 'machine-b' });
        expect(nodes[1]).not.toHaveProperty('machine');
        expect(await textOfProjectFiles()).not.toContain('"machine"');
    });

    test("is bound by the daemon's own path for a node it adds, never into a shared canvas and never into a file", async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        await store.save(projectId, 0, content(), ['main']);
        const add = (bindMachines: ReadonlyMap<string, string>) => (current: ProjectContent) => {
            const view = canvas(current);
            const added = { id: 'n9', kind: 'chat' as const, title: 'there', x: 0, y: 900, w: 560, h: 640 };
            return { content: { ...current, views: [{ ...view, nodes: [...view.nodes, added] }] }, result: null, bindMachines };
        };
        await expect(store.mutate(projectId, add(new Map([['n9', 'machine-b']])))).rejects.toMatchObject({ code: 'remote-node-shared' });
        expect(store.remote.machineOf(projectId, 'n9')).toBeNull();
        await store.save(projectId, 1, content(), []);
        await store.mutate(projectId, add(new Map([['n9', 'machine-b']])));
        expect(store.remote.machineOf(projectId, 'n9')).toBe('machine-b');
        expect(canvas(await store.read(projectId)).nodes.find((node) => node.id === 'n9')).not.toHaveProperty('machine');
        expect(canvas((await store.openProject({ projectId })).document).nodes.find((node) => node.id === 'n9')).toMatchObject({ machine: 'machine-b' });
        expect(await textOfProjectFiles()).not.toContain('"machine"');
    });

    test('keeps its node off a shared canvas, whether the node or the sharing comes second', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        await expect(store.save(projectId, 0, bound('machine-b'), ['main'])).rejects.toMatchObject({ code: 'remote-node-shared' });
        expect(await store.revision(projectId)).toBe(0);

        await store.save(projectId, 0, bound('machine-b'));
        await expect(store.save(projectId, 1, bound(), ['main'])).rejects.toMatchObject({ code: 'remote-node-shared' });
        expect(store.remote.machineOf(projectId, 'n1')).toBe('machine-b');
        // The binding goes with the node, and only then may the canvas travel.
        expect(await store.save(projectId, 1, { ...content(), views: [{ ...canvas(content()), nodes: [] }] }, ['main'])).toBe(2);
    });

    test('is answered per node id for the handlers that would start it here', async () => {
        const projectId = await openBound();
        expect(store.machineOfNode('n1')).toBe('machine-b');
        expect(store.machineOfNode('elsewhere')).toBeNull();
        store.release(projectId);
    });

    test('is taken only for a terminal, chat or device, on another machine, before anything started here', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        const asNote = bound('machine-b');
        canvas(asNote).nodes[0] = { ...canvas(asNote).nodes[0]!, kind: 'note' };
        await expect(store.save(projectId, 0, asNote)).rejects.toMatchObject({ code: 'remote-node-invalid' });
        await expect(store.save(projectId, 0, bound('machine-a'))).rejects.toMatchObject({ code: 'remote-node-invalid' });
        expect(store.remote.nodesOf(projectId)).toEqual({});

        const busy = new ProjectStore(
            join(root, 'busy-home'),
            projectLinks({ bindings: { machineId: 'machine-a', started: async (nodeId) => nodeId === 'n1' } }),
            new FakeWatch()
        );
        const busyId = (await busy.openProject({ folder })).summary.projectId;
        await expect(busy.save(busyId, 0, bound('machine-b'))).rejects.toMatchObject({ code: 'remote-node-invalid' });
        busy.closeAll();
    });

    test('stays on the machine it was bound to', async () => {
        const projectId = await openBound();
        await expect(store.save(projectId, 1, bound('machine-c'))).rejects.toMatchObject({ code: 'remote-node-invalid' });
        expect(await store.save(projectId, 1, bound('machine-b'))).toBe(2);
    });

    test('stays a node on a canvas: becoming a view of its own is refused, and so is a verb doing it', async () => {
        const projectId = await openBound();
        const promoted: ProjectContent = { ...content(), views: [{ kind: 'terminal', id: 'n1', name: 'shell', node: {} }] };
        await expect(store.save(projectId, 1, promoted)).rejects.toMatchObject({ code: 'remote-node-view' });
        await expect(store.mutate(projectId, (current) => ({ content: { ...current, views: promoted.views }, result: null }))).rejects.toMatchObject({
            code: 'remote-node-view'
        });
        expect(store.remote.machineOf(projectId, 'n1')).toBe('machine-b');
        expect(await store.revision(projectId)).toBe(1);
    });

    test('keeps a hidden canvas off the shared file and out of both', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        const hidden = { ...canvas(content()), hidden: true as const };
        await expect(store.save(projectId, 0, { ...content(), views: [hidden] }, ['main'])).rejects.toMatchObject({ code: 'hidden-view-shared' });
        await store.save(projectId, 0, { ...content(), views: [hidden] });
        expect(await textOfProjectFiles()).not.toContain('"hidden"');
    });

    test('is not lost to the id turning up as a view after a pull', async () => {
        await openBound();
        const path = documentPathInFolder(folder);
        const pulled = {
            ...(JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>),
            views: [{ kind: 'terminal', id: 'n1', name: 'shell', node: {} }]
        };
        await writeFile(path, JSON.stringify(pulled, null, 2));
        projectDirWatcher().emit('project.json');
        await fake.settle();
        expect(store.machineOfNode('n1')).toBe('machine-b');
    });

    test('goes when a file edited outside takes the node away, and when a restart finds it gone', async () => {
        const projectId = await openBound();
        await setPrivateViews(folder, [{ ...canvas(content()), nodes: [] }]);
        await pull('from git');
        projectDirWatcher().emit('project.json');
        await fake.settle();
        expect(store.remote.machineOf(projectId, 'n1')).toBeNull();

        await store.save(projectId, await store.revision(projectId), bound('machine-b'));
        expect(store.remote.machineOf(projectId, 'n1')).toBe('machine-b');
        store.closeAll();
        await setPrivateViews(folder, [{ ...canvas(content()), nodes: [] }]);
        const fresh = new ProjectStore(home, projectLinks(), new FakeWatch());
        await fresh.remote.load();
        expect(fresh.remote.machineOf(projectId, 'n1')).toBe('machine-b');
        await fresh.warmIndex();
        expect(fresh.remote.machineOf(projectId, 'n1')).toBeNull();
        fresh.closeAll();
    });

    test('comes back with the node an undo restores, and goes while the node is away', async () => {
        const projectId = await openBound();
        const without: ProjectContent = { ...content(), views: [{ ...canvas(content()), nodes: [] }] };
        await store.save(projectId, 1, without);
        expect(store.remote.machineOf(projectId, 'n1')).toBeNull();
        await store.save(projectId, 2, bound('machine-b'));
        expect(store.remote.machineOf(projectId, 'n1')).toBe('machine-b');
    });

    test('keeps the folder of a node as the other machine knows it, even under this one', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        const underThisFolder = join(folder, 'apps', 'server');
        const view = canvas(content());
        const node = { ...view.nodes[0]!, cwd: underThisFolder, machine: 'machine-b' };
        await store.save(projectId, 0, { ...content(), views: [{ ...view, nodes: [node] }] });
        expect(await textOfProjectFiles()).toContain(JSON.stringify(underThisFolder));
        expect(canvas((await store.openProject({ projectId })).document).nodes[0]!.cwd).toBe(underThisFolder);
        await store.mutate(projectId, (current) => ({ content: { ...current, name: 'by verb' }, result: null }));
        expect(await textOfProjectFiles()).toContain(JSON.stringify(underThisFolder));
    });
});

describe('reading the combined sidebar', () => {
    test('reads released projects without opening them, changing the registry or creating a watcher', async () => {
        const first = await store.openProject({ folder });
        const second = await store.openProject({ folder: join(root, 'Second'), createFolder: true, name: 'Second' });
        store.release(first.summary.projectId);
        store.release(second.summary.projectId);
        const before = await store.list();
        const watcherCount = fake.watchers.length;
        const overview = await store.sidebar();
        expect(overview.projects.map((entry) => entry.summary.projectId).sort()).toEqual(before.map((entry) => entry.projectId).sort());
        expect(overview.projects[0]!.views).toEqual([]);
        expect(await store.list()).toEqual(before);
        expect(fake.watchers.length).toBe(watcherCount);
        expect(overview.projects.flatMap((entry) => entry.views ?? []).every((view) => !('texts' in view) && !('edges' in view))).toBe(true);
    });

    test('excludes closed projects and isolates an unreadable project', async () => {
        const broken = await store.openProject({ folder });
        const closed = await store.openProject({ folder: join(root, 'Closed'), createFolder: true, name: 'Closed' });
        const healthy = await store.openProject({ folder: join(root, 'Healthy'), createFolder: true, name: 'Healthy' });
        await store.closeProject(closed.summary.projectId, 'c1');
        store.release(broken.summary.projectId);
        await writeFile(documentPathInFolder(folder), 'broken json');
        const overview = await store.sidebar();
        expect(overview.projects.map((entry) => entry.summary.projectId)).not.toContain(closed.summary.projectId);
        expect(overview.projects.find((entry) => entry.summary.projectId === broken.summary.projectId)?.views).toBeNull();
        expect(overview.projects.find((entry) => entry.summary.projectId === healthy.summary.projectId)?.views).toHaveLength(0);
        expect(await readFile(documentPathInFolder(folder), 'utf8')).toBe('broken json');
    });

    test('a corrupt private file is not moved aside by a sidebar read', async () => {
        await store.openProject({ folder });
        const actual = privatePathOf(documentPathInFolder(folder));
        await writeFile(actual, 'broken private json');
        const before = await readdir(dirname(actual));
        expect((await store.sidebar()).projects[0]?.views).toBeNull();
        expect(await readFile(actual, 'utf8')).toBe('broken private json');
        expect(await readdir(dirname(actual))).toEqual(before);
    });
});

describe('locks and reads from memory', () => {
    test('a change that takes long on one project holds up no other, and both land in the registry', async () => {
        const first = await store.openProject({ folder });
        const second = await store.openProject({ folder: join(root, 'Second'), createFolder: true, name: 'Second' });
        const gate = Promise.withResolvers<void>();
        const slow = store.mutate(first.summary.projectId, async (current) => {
            await gate.promise;
            return { content: { ...current, name: 'slow' }, result: null };
        });
        await store.mutate(second.summary.projectId, (current) => ({ content: { ...current, name: 'quick' }, result: null }));
        expect((await store.read(second.summary.projectId)).name).toBe('quick');
        gate.resolve();
        await slow;
        const fresh = new ProjectStore(home, projectLinks(), new FakeWatch());
        expect((await fresh.list()).map((project) => project.name).sort()).toEqual(['quick', 'slow']);
    });

    test('an open project answers from memory until its watcher takes an outside edit in', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        await store.save(projectId, 0, content(), undefined, 'c1');
        expect((await store.read(projectId)).name).toBe('repo');

        await pull('from git');
        expect((await store.read(projectId)).name).toBe('repo');
        expect(await store.revision(projectId)).toBe(1);

        projectDirWatcher().emit('project.json');
        await fake.settle();
        expect((await store.read(projectId)).name).toBe('from git');
        expect(await store.revision(projectId)).toBe(2);

        // What a caller gets is its own copy.
        (await store.read(projectId)).views.length = 0;
        expect((await store.read(projectId)).views).toHaveLength(1);
    });

    test('a write of this daemon is read back at once', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        expect(await store.revision(projectId)).toBe(0);
        await store.mutate(projectId, (current) => ({ content: { ...current, name: 'by verb' }, result: null }));
        expect((await store.read(projectId)).name).toBe('by verb');
        await store.save(projectId, 1, content('by person'));
        expect((await store.read(projectId)).name).toBe('by person');
        expect(await store.revision(projectId)).toBe(2);
    });

    test('a project that is not open, or open without a watcher, is read from disk', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        await store.read(projectId);
        store.release(projectId);
        await pull('released');
        expect((await store.read(projectId)).name).toBe('released');

        const blind = new ProjectStore(home, projectLinks(), {
            watch: () => {
                throw new Error('no watcher here');
            },
            schedule: fake.schedule
        });
        await blind.openProject({ projectId });
        await blind.read(projectId);
        await pull('unseen');
        expect((await blind.read(projectId)).name).toBe('unseen');
        blind.closeAll();
    });
});

test('opening without a folder or project id is refused', async () => {
    for (const payload of [{}, { name: 'Loose' }, { folder: '' }]) {
        await expect(store.openProject(payload)).rejects.toMatchObject({ code: 'project-invalid' });
    }
    expect(await store.list()).toEqual([]);
});

describe('the folder of a design', () => {
    const designView = (path = 'onboarding'): ProjectView => ({ kind: 'design', id: 'd1', name: 'Onboarding', node: {}, path });

    const withDesign = (views: ProjectView[]): ProjectContent => ({ name: 'repo', color: '#123456', views });

    async function page(at: string, text: string): Promise<void> {
        await mkdir(join(folder, at), { recursive: true });
        await writeFile(join(folder, at, 'Onboarding.html'), text);
    }

    function pageIn(at: string): Promise<string> {
        return readFile(join(folder, at, 'Onboarding.html'), 'utf8');
    }

    test("follows a person's save that shares its design, and one that makes it private again", async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        await store.save(projectId, 0, withDesign([designView()]));
        await page('.ruimte/private/designs/onboarding', 'one');

        await store.save(projectId, 1, withDesign([designView()]), ['d1']);
        expect(await pageIn('.ruimte/designs/onboarding')).toBe('one');

        await store.save(projectId, 2, withDesign([designView()]), []);
        expect(await pageIn('.ruimte/private/designs/onboarding')).toBe('one');
    });

    test('follows a change that takes a design node off a shared canvas into a view of its own', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        const board = { id: 'board', kind: 'design' as const, title: 'Board', x: 0, y: 0, w: 480, h: 640, path: 'onboarding' };
        await store.save(projectId, 0, withDesign([{ ...emptyCanvasView('main', 'Canvas'), nodes: [board] }]), ['main']);
        await page('.ruimte/designs/onboarding', 'board');

        await store.mutate(projectId, (current) => ({ content: { ...current, views: withNodeAsView(current.views, 'board')!.views }, result: null }));

        expect(await pageIn('.ruimte/private/designs/onboarding')).toBe('board');
        expect(store.index.designOf('board')).toEqual({ folder: join(folder, '.ruimte/private/designs/onboarding'), onCanvas: false });
    });

    test('refuses a save or a change that would put a design on the folder of another, and writes nothing', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        await store.save(projectId, 0, withDesign([designView()]));
        await page('.ruimte/private/designs/onboarding', 'mine');
        await page('.ruimte/designs/onboarding', 'theirs');

        await expect(store.save(projectId, 1, withDesign([designView()]), ['d1'])).rejects.toMatchObject({ code: 'design-folder-taken' });
        const board = { id: 'd1', kind: 'design' as const, title: 'Onboarding', x: 0, y: 0, w: 480, h: 640, path: 'onboarding' };
        await store.save(projectId, 1, withDesign([{ ...emptyCanvasView('main', 'Canvas'), nodes: [] }, designView()]), ['main']);
        await expect(
            store.mutate(projectId, (current) => ({
                content: { ...current, views: [{ ...emptyCanvasView('main', 'Canvas'), nodes: [board] }] },
                result: null
            }))
        ).rejects.toMatchObject({ code: 'design-folder-taken' });

        expect((await documentOnDisk(folder)).rev).toBe(2);
        expect(await pageIn('.ruimte/private/designs/onboarding')).toBe('mine');
        expect(await pageIn('.ruimte/designs/onboarding')).toBe('theirs');
    });

    test('a folder a move left on the other side goes back when the project is opened again', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        await store.save(projectId, 0, withDesign([designView()]), ['d1']);
        // As a stop between the journal and the rename leaves it.
        await page('.ruimte/private/designs/onboarding', 'one');
        const moves = [{ id: 'd1', from: '.ruimte/private/designs/onboarding', to: '.ruimte/designs/onboarding' }];
        await writeFile(join(folder, '.ruimte/private/design-moves.json'), JSON.stringify({ moves }));
        store.closeAll();

        await store.openProject({ projectId });

        expect(await pageIn('.ruimte/designs/onboarding')).toBe('one');
    });

    test('what a chat in a turn still wrote to the folder its design left goes into the new one once the turn ends', async () => {
        let working = true;
        store.closeAll();
        store = new ProjectStore(home, projectLinks({ chatWorking: (chatId) => working && chatId === 'd1' }), fake);
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        await store.save(projectId, 0, withDesign([designView()]));
        await page('.ruimte/private/designs/onboarding', 'one');

        await store.save(projectId, 1, withDesign([designView()]), ['d1']);
        await mkdir(join(folder, '.ruimte/private/designs/onboarding'), { recursive: true });
        await writeFile(join(folder, '.ruimte/private/designs/onboarding', 'Late.html'), 'late');
        working = false;
        await store.settleDesignsAfterTurn('d1');

        expect(await pageIn('.ruimte/designs/onboarding')).toBe('one');
        expect(await readFile(join(folder, '.ruimte/designs/onboarding/Late.html'), 'utf8')).toBe('late');
        expect(await stat(join(folder, '.ruimte/private/designs/onboarding')).catch(() => null)).toBeNull();
    });

    test('a node whose name is no folder of its own moves nothing when its canvas is shared', async () => {
        const opened = await store.openProject({ folder });
        const projectId = opened.summary.projectId;
        const board = { id: 'board', kind: 'design' as const, title: 'Board', x: 0, y: 0, w: 480, h: 640, path: '.' };
        await store.save(projectId, 0, withDesign([{ ...emptyCanvasView('main', 'Canvas'), nodes: [board] }]));
        await page('.ruimte/private/designs/mine', 'mine');

        await store.save(projectId, 1, withDesign([{ ...emptyCanvasView('main', 'Canvas'), nodes: [board] }]), ['main']);

        expect(await pageIn('.ruimte/private/designs/mine')).toBe('mine');
        expect(store.index.designOf('board')).toBeNull();
    });
});
