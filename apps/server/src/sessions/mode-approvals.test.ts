import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectNode, ProjectView, RuntimeMode } from '@ruimte/contracts';
import { FakeWatch } from '@ruimte/agents/watch-test-helpers';
import { documentPathInFolder, privatePathOf } from '../projects/project-files.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { ModeApprovals, modesSet, personModeOf } from './mode-approvals.ts';
import { makeHarness } from './test-helpers.ts';

function terminal(id: string, extra: Partial<ProjectNode> = {}): ProjectNode {
    return { id, kind: 'terminal', title: 'Shell', x: 0, y: 0, w: 10, h: 10, ...extra };
}

function canvasOf(...nodes: ProjectNode[]): ProjectView[] {
    return [{ kind: 'canvas', id: 'main', name: 'Canvas', nodes, texts: [], edges: [], layouts: [] }];
}

describe('modesSet', () => {
    test('names a terminal agent a save adds or changes the mode of, with the default for one that names none', () => {
        const before = canvasOf(
            terminal('kept', { provider: 'claude', runtimeMode: 'auto' }),
            terminal('changed', { provider: 'claude', runtimeMode: 'auto' })
        );
        const after = canvasOf(
            terminal('kept', { provider: 'claude', runtimeMode: 'auto' }),
            terminal('changed', { provider: 'claude', runtimeMode: 'supervised' }),
            terminal('new', { provider: 'codex' }),
            terminal('plain')
        );
        expect(modesSet(before, after)).toEqual([
            { nodeId: 'changed', mode: 'supervised' },
            { nodeId: 'new', mode: 'full-access' }
        ]);
    });

    test('a mode an outside edit put there and a client saves back unchanged is not approved', () => {
        const edited = canvasOf(terminal('t1', { provider: 'claude', runtimeMode: 'full-access' }));
        expect(modesSet(edited, edited)).toEqual([]);
    });

    test('a resume that names no mode is read as the strictest, the way its launch line is', () => {
        expect(modesSet([], canvasOf(terminal('t1', { provider: 'claude', resume: 'claude-1' })))).toEqual([{ nodeId: 't1', mode: 'supervised' }]);
    });

    test('a terminal view of its own counts as well', () => {
        const after: ProjectView[] = [{ kind: 'terminal', id: 'deploy', name: 'Deploy', node: { provider: 'claude', runtimeMode: 'auto-accept-edits' } }];
        expect(modesSet([], after)).toEqual([{ nodeId: 'deploy', mode: 'auto-accept-edits' }]);
    });
});

describe('ModeApprovals', () => {
    let home: string;

    beforeEach(async () => {
        home = await mkdtemp(join(tmpdir(), 'ruimte-mode-approvals-'));
    });

    afterEach(async () => {
        await rm(home, { recursive: true, force: true });
    });

    test('keeps the mode per folder and node across a restart', async () => {
        const approvals = new ModeApprovals(home);
        await approvals.load();
        expect(approvals.modeOf('/work/a', 't1')).toBeNull();
        await approvals.approve('/work/a', 't1', 'auto');

        const restarted = new ModeApprovals(home);
        await restarted.load();
        expect(restarted.modeOf('/work/a', 't1')).toBe('auto');
        expect(restarted.modeOf('/work/b', 't1')).toBeNull();
    });
});

describe('a mode an agent writes into the private project file', () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'ruimte-mode-edit-'));
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test('starts no session in a wider mode than the person saved, also once a client saved it back', async () => {
        const folder = join(root, 'repo');
        await mkdir(folder);
        const store = new ProjectStore(join(root, 'home'), new FakeWatch());
        const approvals = new ModeApprovals(join(root, 'home'));
        await approvals.load();
        // The daemon's own wiring: a person's save is what approves a mode.
        store.attachSaveListener(async (saved, before, after) => {
            for (const { nodeId, mode } of modesSet(before, after)) {
                await approvals.approve(saved, nodeId, mode);
            }
        });
        const { projectId } = (await store.openProject({ folder })).summary;
        await store.save(projectId, 0, { name: 'repo', color: '#123456', views: canvasOf(terminal('t1', { provider: 'claude', runtimeMode: 'auto' })) });

        const path = privatePathOf(documentPathInFolder(folder));
        const file = JSON.parse(await readFile(path, 'utf8')) as { views: Array<{ nodes: Array<Record<string, unknown>> }> };
        file.views[0]!.nodes[0]!.runtimeMode = 'full-access';
        await writeFile(path, JSON.stringify(file));
        // A verb takes the edit in, and every client is sent the document with it.
        const taken = await store.mutate(projectId, (content) => ({ content: { ...content, color: '#654321' }, result: content }));
        await store.save(projectId, 2, { ...taken, color: '#654321' });

        const placed = store.index.locate('t1')!.folder;
        const harness = await makeHarness({ personMode: (sessionId) => personModeOf(approvals.modeOf(placed, sessionId), 'full-access') });
        try {
            const node = (await store.read(projectId)).views.flatMap((view) => (view.kind === 'canvas' ? view.nodes : []))[0]!;
            expect(node.runtimeMode).toBe('full-access');
            await harness.manager.create({ sessionId: 't1', cols: 80, rows: 24, cwd: harness.home, agent: { kind: 'claude', runtimeMode: node.runtimeMode! } });
            expect(harness.adapter.forSession('t1').input[0]).toContain('--permission-mode auto');
        } finally {
            store.closeAll();
            await harness.cleanup();
        }
    });
});

describe('personModeOf', () => {
    test("a person's save first, then the terminal mode they pick now, then the strictest", () => {
        const cases: Array<[RuntimeMode | null, RuntimeMode | undefined, RuntimeMode]> = [
            ['auto', 'full-access', 'auto'],
            [null, 'auto-accept-edits', 'auto-accept-edits'],
            [null, undefined, 'supervised']
        ];
        for (const [approved, preference, expected] of cases) {
            expect(personModeOf(approved, preference)).toBe(expected);
        }
    });
});
