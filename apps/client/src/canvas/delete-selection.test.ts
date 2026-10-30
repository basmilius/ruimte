import { beforeEach, expect, test } from 'bun:test';
import { useEndingAgents } from '@/agents/end-children';
import { deleteSelectionAsking } from '@/canvas/delete-selection';
import { createCanvasStore, type CanvasNode } from '@/state/canvas';

function node(id: string, kind: CanvasNode['kind'], x: number): CanvasNode {
    return { id, kind, title: id === 'lead' ? 'Lead' : id, x, y: 0, w: 200, h: 100 };
}

/* A canvas holding these nodes, loaded the way a view opens. */
function canvasWith(...nodes: CanvasNode[]) {
    const store = createCanvasStore();
    store.getState().loadView({ kind: 'canvas', id: 'view', name: 'Canvas', nodes, texts: [], edges: [], layouts: [] }, null);
    return store;
}

function machine(children: Record<string, string[]>) {
    return {
        request: async (_type: string, payload: { nodeId: string }) => ({ nodeIds: children[payload.nodeId] ?? [] })
    } as never;
}

beforeEach(() => {
    useEndingAgents.setState({ pending: null });
});

test('a node whose agents would end waits for the answer, and the delete takes what was picked then', async () => {
    const store = canvasWith(node('lead', 'chat', 0), node('note', 'note', 900));
    store.getState().select(['lead']);
    await deleteSelectionAsking(store, machine({ lead: ['child-a', 'child-b'] }));

    expect(useEndingAgents.getState().pending).toMatchObject({ what: 'Lead', agents: 2 });
    expect(store.getState().nodes.lead).toBeDefined();
    // The person clicks elsewhere before answering.
    store.getState().select(['note']);
    useEndingAgents.getState().pending!.run();
    expect(store.getState().nodes.lead).toBeUndefined();
    expect(store.getState().nodes.note).toBeDefined();
});

test('a design node asks about the agents of every chat it holds, its later ones included', async () => {
    const design = { ...node('design', 'design', 0), chats: [{ id: 'later', name: 'Second pass', node: {} }] };
    const store = canvasWith(design);
    store.getState().select(['design']);
    await deleteSelectionAsking(store, machine({ later: ['child-a'] }));

    expect(useEndingAgents.getState().pending).toMatchObject({ what: 'design', agents: 1 });
    expect(store.getState().nodes.design).toBeDefined();
});

test('a design node leaves behind the worktree a later chat of it works in', async () => {
    const design = { ...node('design', 'design', 0), chats: [{ id: 'later', name: 'Second pass', node: { cwd: '/wt/later' } }] };
    const store = canvasWith(design);
    store.getState().select(['design']);
    const transport = {
        request: async (type: string) =>
            type === 'agent.children' ? { nodeIds: [] } : { worktrees: [{ path: '/wt/later', branch: 'later', work: { changed: 0, untracked: 0, ahead: 0 } }] }
    } as never;

    await deleteSelectionAsking(store, transport, '/project');

    expect(useEndingAgents.getState().pending).toMatchObject({ agents: 0, worktrees: { folder: '/project', worktrees: [{ branch: 'later' }] } });
});

test('a node that opened nothing goes at once', async () => {
    const store = canvasWith(node('shell', 'terminal', 0));
    store.getState().select(['shell']);
    await deleteSelectionAsking(store, machine({}));
    expect(useEndingAgents.getState().pending).toBeNull();
    expect(store.getState().nodes.shell).toBeUndefined();
});

test('a node outside every worktree goes without counting the work in them', async () => {
    const store = canvasWith({ ...node('lead', 'chat', 0), cwd: '/project' });
    store.getState().select(['lead']);
    const asked: unknown[] = [];
    const transport = {
        request: async (type: string, payload: unknown) => {
            asked.push(payload);
            return type === 'agent.children' ? { nodeIds: [] } : { worktrees: [{ path: '/wt/other', branch: 'other' }] };
        }
    } as never;

    await deleteSelectionAsking(store, transport, '/project');

    expect(store.getState().nodes.lead).toBeUndefined();
    expect(asked).not.toContainEqual(expect.objectContaining({ inspect: true }));
});

test('a node that works in a worktree asks even when it opened nothing, and offers the worktrees nothing that stays works in', async () => {
    const lexer = { ...node('lexer', 'chat', 0), cwd: '/wt/lexer' };
    const parser = { ...node('parser', 'terminal', 300), cwd: '/wt/parser' };
    const watcher = { ...node('watcher', 'terminal', 600), cwd: '/wt/parser/src' };
    const store = canvasWith(lexer, parser, watcher);
    store.getState().select(['lexer', 'parser']);
    const transport = {
        request: async (type: string) =>
            type === 'agent.children'
                ? { nodeIds: [] }
                : {
                      worktrees: [
                          { path: '/wt/lexer', branch: 'lexer', work: { changed: 0, untracked: 0, ahead: 0 } },
                          { path: '/wt/parser', branch: 'parser', work: { changed: 0, untracked: 0, ahead: 0 } }
                      ]
                  }
    } as never;

    await deleteSelectionAsking(store, transport, '/project');

    expect(useEndingAgents.getState().pending).toMatchObject({ agents: 0, worktrees: { folder: '/project', worktrees: [{ branch: 'lexer' }] } });
    expect(store.getState().nodes.lexer).toBeDefined();
});
