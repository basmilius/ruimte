import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectContent } from '@ruimte/contracts';
import { FakeWatch } from '@ruimte/agents/watch-test-helpers';
import { ProjectStore } from './project-store.ts';
import { DrawingStore } from './drawing-store.ts';
import { DiagramStore } from './diagram-store.ts';
import { documentPathInFolder, viewFilePathOf } from './project-files.ts';
import { pendingWritePathOf, PROJECT_WRITE_IO, type ProjectWriteIO } from './project-write.ts';

let root: string;
let folder: string;
let home: string;
let projects: ProjectStore;
let drawings: DrawingStore;
let diagrams: DiagramStore;
let projectId: string;
let failAt: number;
let operations: number;
let afterOperation: boolean;
let duringWrite: (() => Promise<void>) | null;
let duringAt: number;
const content: ProjectContent = {
    name: 'repo',
    color: '#353e53',
    views: [
        { kind: 'drawing', id: 'sketch', name: 'Sketch' },
        { kind: 'diagram', id: 'flow', name: 'Flow' }
    ]
};

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-project-write-'));
    folder = join(root, 'repo');
    home = join(root, 'home');
    await mkdir(folder);
    failAt = 0;
    operations = 0;
    afterOperation = false;
    duringWrite = null;
    duringAt = 3;
    const step = async (work: () => Promise<void>): Promise<void> => {
        operations += 1;
        if (failAt === operations && !afterOperation) {
            throw new Error('Injected write failure');
        }
        await work();
        if (operations === duringAt && duringWrite) {
            await duringWrite();
        }
        if (failAt === operations && afterOperation) {
            throw new Error('Injected write failure');
        }
    };
    const io: ProjectWriteIO = {
        write: (...args) => step(() => PROJECT_WRITE_IO.write(...args)),
        remove: (path) => step(() => PROJECT_WRITE_IO.remove(path))
    };
    const watch = new FakeWatch();
    projects = new ProjectStore(home, watch, io);
    drawings = new DrawingStore(projects, watch);
    diagrams = new DiagramStore(projects, watch);
    projects.attachDrawings(drawings);
    projects.attachDiagrams(diagrams);
    projectId = (await projects.openProject({ folder })).summary.projectId;
    await projects.save(projectId, 0, content);
    await drawings.open(projectId, 'sketch');
    await drawings.save(projectId, 'sketch', 0, {
        elements: [{ kind: 'text', id: 'text', x: 0, y: 0, w: 160, h: 40, text: 'keep my work', size: 24, stroke: 'ink', strokeWidth: 2, seed: 1 }]
    });
    await diagrams.open(projectId, 'flow');
    await diagrams.save(projectId, 'flow', 0, { meta: { title: 'keep', direction: 'right' }, nodes: [{ id: 'old', label: 'Old' }], groups: [], edges: [] });
    operations = 0;
});
afterEach(async () => {
    projects.closeAll();
    await rm(root, { recursive: true, force: true });
});

describe('durable project saves', () => {
    for (const after of [false, true]) {
        for (let stage = 1; stage <= 8; stage++) {
            test(`recovers after restarting ${after ? 'after' : 'before'} filesystem operation ${stage}`, async () => {
                const path = documentPathInFolder(folder);
                const drawing = await readFile(viewFilePathOf(path, 'drawing', 'sketch', []));
                const diagram = await readFile(viewFilePathOf(path, 'diagram', 'flow', []));
                failAt = stage;
                afterOperation = after;
                await expect(projects.save(projectId, 1, { ...content, name: 'saved' }, ['sketch', 'flow'])).rejects.toThrow('Injected');
                projects.closeAll();
                projects = new ProjectStore(home, new FakeWatch());
                const opened = await projects.openProject({ projectId });
                const landed = after || stage > 1;
                expect(opened.document.rev).toBe(landed ? 2 : 1);
                expect(opened.document.name).toBe(landed ? 'saved' : 'repo');
                expect(opened.document.views.map((view) => view.id)).toEqual(['sketch', 'flow']);
                expect(opened.document.shared).toEqual(landed ? ['sketch', 'flow'] : []);
                expect(await readFile(viewFilePathOf(path, 'drawing', 'sketch', opened.document.shared ?? []))).toEqual(drawing);
                expect(await readFile(viewFilePathOf(path, 'diagram', 'flow', opened.document.shared ?? []))).toEqual(diagram);
                expect(await stat(pendingWritePathOf(path)).catch(() => null)).toBeNull();
            });
        }
    }
    test('a view relocation failure is reported and can be completed without restarting', async () => {
        failAt = 4;
        await expect(projects.save(projectId, 1, content, ['sketch', 'flow'])).rejects.toThrow('Injected');
        failAt = 0;
        await expect(projects.save(projectId, 1, content, ['sketch', 'flow'])).rejects.toMatchObject({ code: 'rev-conflict' });
        expect(await projects.revision(projectId)).toBe(2);
        expect(await projects.save(projectId, 2, content, ['sketch', 'flow'])).toBe(3);
        expect((await drawings.open(projectId, 'sketch')).elements).toHaveLength(1);
    });
    test('recovery refuses a subsequent outside edit and keeps the recovery record', async () => {
        failAt = 3;
        await expect(projects.save(projectId, 1, content, ['sketch', 'flow'])).rejects.toThrow('Injected');
        const path = documentPathInFolder(folder);
        await writeFile(path, 'outside edit');
        projects.closeAll();
        projects = new ProjectStore(home, new FakeWatch());
        const refused = await projects.openProject({ projectId }).catch((e: unknown) => e);
        // A coded error, so a verb is refused instead of failing, and it names the file that lets the save go.
        expect(refused).toMatchObject({ code: 'project-invalid' });
        expect((refused as Error).message).toContain('changed since');
        expect((refused as Error).message).toContain(pendingWritePathOf(path));
        expect(await readFile(path, 'utf8')).toBe('outside edit');
        expect(await stat(pendingWritePathOf(path))).toBeDefined();
    });

    test('a project file that changes before the first write is a conflict, and leaves nothing to recover', async () => {
        const path = documentPathInFolder(folder);
        duringAt = 1;
        duringWrite = async () => {
            const pulled = { ...(JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>), name: 'pulled' };
            await writeFile(path, JSON.stringify(pulled, null, 2));
        };
        await expect(projects.save(projectId, 1, { ...content, color: '#654321' })).rejects.toMatchObject({ code: 'rev-conflict' });
        expect(await stat(pendingWritePathOf(path)).catch(() => null)).toBeNull();

        duringWrite = null;
        expect(await projects.read(projectId)).toMatchObject({ name: 'pulled' });
        projects.closeAll();
        projects = new ProjectStore(home, new FakeWatch());
        expect((await projects.openProject({ projectId })).document.name).toBe('pulled');
    });

    test('a view edited while the project files are written is preserved beside the recovery record', async () => {
        const path = documentPathInFolder(folder);
        const source = viewFilePathOf(path, 'drawing', 'sketch', []);
        const original = await readFile(source);
        duringWrite = () => writeFile(source, 'newer view bytes');
        await expect(projects.save(projectId, 1, content, ['sketch', 'flow'])).rejects.toThrow('changed since');
        expect(await readFile(source, 'utf8')).toBe('newer view bytes');
        const pending = JSON.parse(await readFile(pendingWritePathOf(path), 'utf8')) as { moves: Array<{ kind: string; bytes: string }> };
        expect(Buffer.from(pending.moves.find((move) => move.kind === 'drawing')!.bytes, 'base64')).toEqual(original);
    });
});
