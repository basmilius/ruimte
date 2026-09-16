import { beforeEach, expect, test } from 'bun:test';
import { useEndingAgents } from '@/agents/end-children';
import { deleteSelectionAsking } from '@/canvas/delete-selection';
import { createCanvasStore, type CanvasNode } from '@/state/canvas';

const node = (id: string, kind: CanvasNode['kind'], x: number): CanvasNode => ({ id, kind, title: id === 'lead' ? 'Lead' : id, x, y: 0, w: 200, h: 100 });

/* A canvas holding these nodes, loaded the way a view opens. */
const canvasWith = (...nodes: CanvasNode[]) => {
    const store = createCanvasStore();
    store.getState().loadView({ kind: 'canvas', id: 'view', name: 'Canvas', nodes, texts: [], edges: [], layouts: [] }, null);
    return store;
};

const machine = (children: Record<string, string[]>) =>
    ({
        request: async (_type: string, payload: { nodeId: string }) => ({ nodeIds: children[payload.nodeId] ?? [] })
    }) as never;

beforeEach(() => {
    useEndingAgents.setState({ pending: null });
});

test('a node whose agents would end waits for the answer, and the delete takes what was picked then', async () => {
    const store = canvasWith(node('lead', 'chat', 0), node('note', 'note', 900));
    const lead = 'lead';
    const note = 'note';
    store.getState().select([lead]);
    await deleteSelectionAsking(store, machine({ [lead]: ['child-a', 'child-b'] }));

    expect(useEndingAgents.getState().pending).toMatchObject({ what: 'Lead', agents: 2 });
    expect(store.getState().nodes[lead]).toBeDefined();
    // The person clicks elsewhere before answering.
    store.getState().select([note]);
    useEndingAgents.getState().pending!.run();
    expect(store.getState().nodes[lead]).toBeUndefined();
    expect(store.getState().nodes[note]).toBeDefined();
});

test('a node that opened nothing goes at once', async () => {
    const store = canvasWith(node('shell', 'terminal', 0));
    const shell = 'shell';
    store.getState().select([shell]);
    await deleteSelectionAsking(store, machine({}));
    expect(useEndingAgents.getState().pending).toBeNull();
    expect(store.getState().nodes[shell]).toBeUndefined();
});
