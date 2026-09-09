import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectContent, ProjectDocument } from '@ruimte/contracts';
import type { SessionEvent } from '../sessions/manager.ts';
import { waitFor } from '../sessions/test-helpers.ts';
import { documentPathInFolder, fromPortable, toPortable } from './project-files.ts';
import { ProjectStore } from './project-store.ts';

let root: string;
let home: string;
let folder: string;
let store: ProjectStore;
let changed: SessionEvent[];

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-projects-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder);
    store = new ProjectStore(home);
    changed = [];
    store.subscribe('c1', (event) => {
        changed.push(event);
    });
});

afterEach(async () => {
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

const content = (name = 'repo'): ProjectContent => ({
    name,
    color: '#123456',
    nodes: [{ id: 'n1', kind: 'terminal', title: 'shell', x: 0, y: 0, w: 560, h: 360, cwd: join(folder, 'apps', 'server') }],
    texts: [],
    edges: []
});

describe('ProjectStore', () => {
    test('opening a folder creates the canvas file, lists it, and saves with a rising rev', async () => {
        const opened = await store.openProject({ folder });
        expect(opened.summary).toMatchObject({ name: 'repo', folder, available: true });
        expect(opened.document).toMatchObject({ version: 1, rev: 0, nodes: [] });
        expect(opened.local).toEqual({ camera: null, focusedNodeId: null });

        expect(await store.save(opened.summary.projectId, 0, content())).toBe(1);
        expect(await store.save(opened.summary.projectId, 1, content('renamed'))).toBe(2);
        const onDisk = JSON.parse(await readFile(documentPathInFolder(folder), 'utf8')) as ProjectDocument;
        expect(onDisk.rev).toBe(2);
        // Relative on disk, absolute once read back.
        expect(onDisk.nodes[0]?.cwd).toBe('./apps/server');
        expect((await store.list())[0]).toMatchObject({ name: 'renamed', available: true });

        const again = await store.openProject({ projectId: opened.summary.projectId });
        expect(again.document.nodes[0]?.cwd).toBe(join(folder, 'apps', 'server'));
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
        await store.saveLocal(opened.summary.projectId, { camera: { x: 1, y: 2, zoom: 0.5 }, focusedNodeId: 'n1' });
        const again = await store.openProject({ projectId: opened.summary.projectId });
        expect(again.local).toEqual({ camera: { x: 1, y: 2, zoom: 0.5 }, focusedNodeId: 'n1' });
        const files = await readdir(join(home, 'projects'));
        expect(files).toContain(`${opened.summary.projectId}.local.json`);

        await store.delete(opened.summary.projectId, true);
        expect(await store.list()).toEqual([]);
        expect(await readdir(join(home, 'projects'))).toEqual([]);
    });

    test('deleting a folder project without removing files keeps the canvas on disk', async () => {
        const opened = await store.openProject({ folder });
        await store.delete(opened.summary.projectId, false);
        expect(await store.list()).toEqual([]);
        expect(await readFile(documentPathInFolder(folder), 'utf8')).toContain('"version": 1');
    });

    test('an empty daemon lists one default canvas, and two opens at once both end up registered', async () => {
        const listed = await store.list();
        expect(listed.map((project) => project.name)).toEqual(['Untitled canvas']);
        const [a, b] = await Promise.all([store.openProject({ name: 'a' }), store.openProject({ name: 'b' })]);
        expect((await store.list()).map((project) => project.projectId).sort()).toEqual(
            [listed[0]!.projectId, a.summary.projectId, b.summary.projectId].sort()
        );
    });

    test('a folder that is gone and an unknown id are refused', async () => {
        await expect(store.openProject({ folder: join(root, 'nope') })).rejects.toMatchObject({ code: 'folder-not-found' });
        await expect(store.openProject({ projectId: 'nope' })).rejects.toMatchObject({ code: 'project-not-found' });
    });
});

describe('portable paths', () => {
    test('paths inside the folder go relative, the folder itself is a dot, outside stays absolute', () => {
        const portable = toPortable(
            {
                name: 'x',
                color: '',
                nodes: [
                    { id: 'a', kind: 'terminal', title: '', x: 0, y: 0, w: 1, h: 1, cwd: '/repo/apps' },
                    { id: 'b', kind: 'terminal', title: '', x: 0, y: 0, w: 1, h: 1, cwd: '/repo' },
                    { id: 'c', kind: 'terminal', title: '', x: 0, y: 0, w: 1, h: 1, cwd: '/elsewhere' },
                    { id: 'd', kind: 'chat', title: '', x: 0, y: 0, w: 1, h: 1 }
                ],
                texts: [],
                edges: []
            },
            '/repo'
        );
        expect(portable.nodes.map((node) => node.cwd)).toEqual(['./apps', '.', '/elsewhere', undefined]);
        expect(fromPortable(portable, '/repo').nodes.map((node) => node.cwd)).toEqual(['/repo/apps', '/repo', '/elsewhere', undefined]);
    });
});
