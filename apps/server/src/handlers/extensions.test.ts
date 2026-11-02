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

/* What `extension.contextRead` answers over two canvases, by source id. */
function contextRead(): (of: { nodeIds?: string[]; viewId?: string }) => Promise<string[]> {
    const handlers = new Map<string, Handler>();
    const dispatcher = { register: (type: string, handler: Handler) => void handlers.set(type, handler) } as unknown as Dispatcher;
    const deps = {
        viewsOf: () => [canvas('plan', 'a1', 'a2'), canvas('notes', 'b1')],
        folderOf: () => '/work',
        readSource: async (source: { text?: string }) => source.text ?? ''
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
});
