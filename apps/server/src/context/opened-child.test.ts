import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatItem, ProjectCanvasView } from '@ruimte/contracts';
import { AgentLineageStore } from '../agents/lineage.ts';
import { ProjectIndex } from '../projects/project-index.ts';
import { ContextRefusal, ContextStore } from './context-store.ts';
import { openedChildSource } from './opened-child.ts';

/* Two parents side by side, each with a child, and a grandchild the first child opened; no line anywhere. */
const canvas: ProjectCanvasView = {
    id: 'main',
    name: 'Canvas',
    kind: 'canvas',
    nodes: [
        { id: 'parent', kind: 'chat', title: 'Planner', x: 0, y: 0, w: 400, h: 300 },
        { id: 'child', kind: 'chat', title: 'Worker', x: 500, y: 0, w: 400, h: 300 },
        { id: 'grandchild', kind: 'chat', title: 'Helper', x: 1000, y: 0, w: 400, h: 300 },
        { id: 'other', kind: 'chat', title: 'Other planner', x: 0, y: 400, w: 400, h: 300 },
        { id: 'others-child', kind: 'terminal', title: 'Other worker', x: 500, y: 400, w: 400, h: 300 },
        { id: 'shell', kind: 'terminal', title: 'Build', x: 1000, y: 400, w: 400, h: 300 },
        { id: 'memo', kind: 'note', title: 'Memo', body: 'hello', x: 0, y: 800, w: 200, h: 200 }
    ],
    texts: [],
    edges: [],
    layouts: []
};

const thread = (text: string): ChatItem[] => [
    { id: 'u', kind: 'user', createdAt: 1, turnId: 't', text },
    { id: 'a', kind: 'assistant', createdAt: 2, turnId: 't', text: `Done: ${text}`, streaming: false }
];

let home: string;
let lineage: AgentLineageStore;
let store: ContextStore;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-opened-child-'));
    lineage = new AgentLineageStore(home);
    await lineage.load();
    await lineage.put({ projectId: 'p', nodeId: 'child', openedBy: 'parent', depth: 1, agent: true });
    await lineage.put({ projectId: 'p', nodeId: 'grandchild', openedBy: 'child', depth: 2, agent: true });
    await lineage.put({ projectId: 'p', nodeId: 'others-child', openedBy: 'other', depth: 1, agent: true });
    await lineage.put({ projectId: 'p', nodeId: 'memo', openedBy: 'parent', depth: 1, agent: false });
    const index = new ProjectIndex();
    index.set('p', '/work/p', { views: [canvas] });
    // The daemon's own wiring, over a real lineage and index.
    store = new ContextStore({
        sources: () => [],
        opened: (targetId, sourceId) =>
            openedChildSource(targetId, sourceId, { madeBy: (id) => lineage.madeBy(id), agentSource: (id) => index.agentSource(id) }),
        drawingElements: async () => null,
        diagramDocument: async () => null,
        terminalText: async (id) => (id === 'others-child' || id === 'shell' ? `${id} screen` : null),
        chatItems: (id) => thread(`the thread of ${id}`),
        subagentItems: async (chatId, toolUseId) => thread(`${toolUseId} of ${chatId}`),
        canvasOf: (id) => index.canvasOf(id)
    });
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

const refusalOf = async (reader: string, source: string): Promise<string> => {
    try {
        await store.answer(reader, source, null, null);
    } catch (e) {
        return e instanceof ContextRefusal ? e.code : 'thrown';
    }
    return 'read';
};

describe('a node the caller opened itself', () => {
    test('reads without a line, whole, by --tail and by --subagent', async () => {
        expect(await store.answer('parent', 'child', null, null)).toBe('## User\n\nthe thread of child\n\n## Assistant\n\nDone: the thread of child');
        expect(await store.answer('parent', 'child', 1, null)).toBe('Done: the thread of child');
        expect(await store.answer('parent', 'child', null, 'toolu_1')).toContain('toolu_1 of child');
        expect(await store.answer('other', 'others-child', null, null)).toBe('others-child screen');
    });

    test('never shows up in what the caller lists', () => {
        expect(store.list('parent')).toEqual([]);
    });

    test('a child of another agent still needs a line', async () => {
        expect(await refusalOf('parent', 'others-child')).toBe('not-linked');
        expect(await refusalOf('other', 'child')).toBe('not-linked');
        expect(await refusalOf('parent', 'shell')).toBe('not-linked');
    });

    test('a grandchild is its own parent to read, never the grandparent', async () => {
        expect(await refusalOf('parent', 'grandchild')).toBe('not-linked');
        expect(await store.answer('child', 'grandchild', 1, null)).toBe('Done: the thread of grandchild');
    });

    test('a child reads its parent no more than before, and a note the caller made is no agent', async () => {
        expect(await refusalOf('child', 'parent')).toBe('not-linked');
        expect(await refusalOf('parent', 'memo')).toBe('not-linked');
    });
});
