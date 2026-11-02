import { describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectView } from '@ruimte/contracts';
import type { Dispatcher } from '../dispatcher.ts';
import type { ExtensionHost } from '../extensions/extension-host.ts';
import { registerExtensionHandlers, type ExtensionHandlerDeps } from './extensions.ts';

type Handler = (payload: unknown, client: unknown) => Promise<unknown>;

function canvas(id: string, ...nodeIds: string[]): ProjectView {
    const nodes: ProjectCanvasView['nodes'] = nodeIds.map((nodeId) => ({
        id: nodeId,
        kind: 'note',
        title: nodeId,
        body: `Body of ${nodeId}`,
        x: 0,
        y: 0,
        w: 100,
        h: 100
    }));

    return { kind: 'canvas', id, name: id, nodes, texts: [], edges: [], layouts: [] };
}

function agentsCanvas(): ProjectView {
    const at = { x: 0, y: 0, w: 100, h: 100 };

    return {
        kind: 'canvas',
        id: 'agents',
        name: 'agents',
        nodes: [
            { id: 'shell', kind: 'terminal', title: 'Shell', ...at },
            { id: 'helper', kind: 'chat', title: 'Helper', ...at }
        ],
        texts: [],
        edges: [],
        layouts: []
    } as ProjectView;
}

/* What `extension.contextRead` answers over three canvases, by source id, with every source it read in `reads`. */
function contextRead(reads: string[] = []): (of: { nodeIds?: string[]; viewId?: string; kind?: string }) => Promise<string[]> {
    const handlers = new Map<string, Handler>();
    const dispatcher = { register: (type: string, handler: Handler) => void handlers.set(type, handler) } as unknown as Dispatcher;
    const deps = {
        viewsOf: () => [canvas('plan', 'a1', 'a2'), canvas('notes', 'b1'), agentsCanvas()],
        folderOf: () => '/work',
        readSource: async (source: { id: string; text?: string }) => {
            reads.push(source.id);

            return source.text ?? '';
        }
    } as unknown as ExtensionHandlerDeps;

    registerExtensionHandlers(dispatcher, {} as ExtensionHost, deps);

    return async (of) => {
        const { sources } = (await (handlers.get('extension.contextRead') as Handler)({ projectId: 'project-1', ...of }, {})) as { sources: { id: string }[] };

        return sources.map((source) => source.id);
    };
}

describe('extension.contextRead', () => {
    test('reads each node it names and every node on the view it names, once, and nothing when it names neither', async () => {
        const read = contextRead();

        expect(await read({})).toEqual([]);
        expect(await read({ nodeIds: ['b1'] })).toEqual(['b1']);
        expect(await read({ viewId: 'plan' })).toEqual(['a1', 'a2']);
        expect(await read({ nodeIds: ['a1', 'b1'], viewId: 'plan' })).toEqual(['a1', 'a2', 'b1']);
    });

    test('never reads a node of another kind than the one asked, so a terminal read cannot reach a chat', async () => {
        const reads: string[] = [];
        const read = contextRead(reads);

        expect(await read({ nodeIds: ['helper'], kind: 'terminal' })).toEqual([]);
        expect(reads).toEqual([]);
        expect(await read({ viewId: 'agents', kind: 'terminal' })).toEqual(['shell']);
        expect(reads).toEqual(['shell']);
    });
});
