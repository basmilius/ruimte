import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ProjectContent } from '@ruimte/contracts';
import { FakeWatch } from '@ruimte/agents/watch-test-helpers';
import type { SessionEvent } from '../sessions/manager.ts';
import { ProjectStore } from './project-store.ts';
import { DrawingStore } from './drawing-store.ts';
import { DiagramStore } from './diagram-store.ts';
import { documentPathInFolder, viewFilePathOf } from './project-files.ts';

for (const kind of ['drawing', 'diagram'] as const) {
    describe(`${kind} file safety`, () => {
        let root: string;
        let projects: ProjectStore;
        let drawings: DrawingStore;
        let diagrams: DiagramStore;
        let watch: FakeWatch;
        let projectId: string;
        let path: string;
        const content: ProjectContent = { name: 'repo', color: '#353e53', views: [{ kind, id: 'view', name: 'View' }] };
        const shape = { kind: 'rect' as const, id: 'old', x: 0, y: 0, w: 160, h: 96, stroke: 'ink' as const, strokeWidth: 2 as const, seed: 12 };
        const graph = (id: string) => ({ meta: { title: '', direction: 'right' as const }, nodes: [{ id, label: id }], groups: [], edges: [] });
        const save = (rev: number, id = 'old', origin = 'writer') =>
            kind === 'drawing'
                ? drawings.save(projectId, 'view', rev, { elements: [{ ...shape, id }] }, origin)
                : diagrams.save(projectId, 'view', rev, graph(id), origin);
        const store = () => (kind === 'drawing' ? drawings : diagrams);
        const idsOf = async () => {
            const document = await store().open(projectId, 'view');
            return 'elements' in document ? document.elements.map((entry) => entry.id) : document.nodes.map((entry) => entry.id);
        };
        beforeEach(async () => {
            root = await mkdtemp(join(tmpdir(), 'ruimte-view-safety-'));
            const folder = join(root, 'repo');
            await mkdir(folder);
            watch = new FakeWatch();
            projects = new ProjectStore(join(root, 'home'), watch);
            drawings = new DrawingStore(projects, watch);
            diagrams = new DiagramStore(projects, watch);
            projects.attachDrawings(drawings);
            projects.attachDiagrams(diagrams);
            projectId = (await projects.openProject({ folder })).summary.projectId;
            await projects.save(projectId, 0, content);
            path = documentPathInFolder(folder);
            await store().open(projectId, 'view');
            await save(0);
        });
        afterEach(async () => {
            projects.closeAll();
            await rm(root, { recursive: true, force: true });
        });

        for (const observed of [false, true]) {
            for (const replacement of ['newer', 'invalid', 'unreadable'] as const) {
                test(`refuses ${replacement} bytes ${observed ? 'after' : 'before'} the watcher reads them`, async () => {
                    const file = viewFilePathOf(path, kind, 'view', []);
                    const document = JSON.parse(await readFile(file, 'utf8'));
                    const text =
                        replacement === 'newer'
                            ? JSON.stringify({ ...document, version: 2, future: 'keep' })
                            : replacement === 'invalid'
                              ? JSON.stringify({ version: 1, rev: 7 })
                              : '{ unfinished';
                    await writeFile(file, text);
                    if (observed) {
                        watch.on(dirname(file)).emit('view.json');
                        await watch.settle();
                    }
                    await expect(save(1, 'mine')).rejects.toMatchObject({ code: replacement === 'unreadable' ? 'rev-conflict' : `${kind}-invalid` });
                    expect(await readFile(file, 'utf8')).toBe(text);
                });
            }
        }
        test('a missing file can be restored at the existing revision', async () => {
            const file = viewFilePathOf(path, kind, 'view', []);
            await rm(file);
            expect(await save(1, 'restored')).toBe(2);
            expect(await idsOf()).toEqual(['restored']);
        });
        test('sharing and making private work before the first editor opens after a restart', async () => {
            const original = await readFile(viewFilePathOf(path, kind, 'view', []));
            for (const shared of [['view'], []]) {
                await projects.openProject({ projectId });
                const rev = await projects.revision(projectId);
                await projects.save(projectId, rev, content, shared);
                const file = viewFilePathOf(path, kind, 'view', shared);
                expect(await readFile(file)).toEqual(original);
                expect(await stat(viewFilePathOf(path, kind, 'view', shared.length ? [] : ['view'])).catch(() => null)).toBeNull();
                expect(await idsOf()).toEqual(['old']);
            }
        });
        test('a save informs the other client once and never echoes to its writer', async () => {
            const written: SessionEvent[] = [];
            const received: SessionEvent[] = [];
            store().subscribe('writer', (event) => written.push(event));
            store().subscribe('reader', (event) => received.push(event));
            await store().open(projectId, 'view');
            expect(await save(1, 'new')).toBe(2);
            watch.on(dirname(viewFilePathOf(path, kind, 'view', []))).emit('view.json');
            await watch.settle();
            expect(written).toEqual([]);
            expect(received).toHaveLength(1);
            expect(received[0]).toMatchObject({ event: `${kind}.changed`, payload: { projectId, viewId: 'view', document: { rev: 2 } } });
            expect(await idsOf()).toEqual(['new']);
        });
        test('an existing destination blocks sharing without overwriting either file', async () => {
            const target = viewFilePathOf(path, kind, 'view', ['view']);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, 'other work');
            await expect(projects.save(projectId, 1, content, ['view'])).rejects.toThrow('both sides');
            expect(await readFile(target, 'utf8')).toBe('other work');
            expect(await idsOf()).toEqual(['old']);
            expect(await projects.revision(projectId)).toBe(1);
        });

        if (kind === 'diagram') {
            test('a released shared diagram keeps its file and revision for agent reads and writes', async () => {
                await projects.save(projectId, 1, content, ['view']);
                projects.release(projectId);
                expect((await diagrams.read(projectId, 'view'))?.nodes.map((node) => node.id)).toEqual(['old']);
                expect(await diagrams.write(projectId, 'view', graph('new'))).toBe(2);
                expect(await stat(viewFilePathOf(path, kind, 'view', [])).catch(() => null)).toBeNull();
                await projects.openProject({ projectId });
                expect(await idsOf()).toEqual(['new']);
            });
        } else {
            test('context follows the editor through sharing and making private, and refuses broken bytes', async () => {
                for (const shared of [[], ['view'], []]) {
                    await projects.save(projectId, await projects.revision(projectId), content, shared);
                    expect((await drawings.elementsOf('view'))?.map((element) => element.id)).toEqual(await idsOf());
                }
                const file = viewFilePathOf(path, kind, 'view', []);
                await writeFile(file, '{ unfinished');
                await expect(drawings.elementsOf('view')).rejects.toMatchObject({ code: 'drawing-invalid' });
                expect(await readFile(file, 'utf8')).toBe('{ unfinished');
            });
        }
    });
}
