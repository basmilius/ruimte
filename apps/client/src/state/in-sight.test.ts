import { beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectView, SplitLayout } from '@ruimte/contracts';
import { useDesignChat } from '@/design/design-chat';
import { nodesInSightOf, type NodeSightWorkspace } from '@/state/in-sight';

describe('what a person has in sight of a design', () => {
    const layout = (...viewIds: string[]): SplitLayout => ({
        columns: viewIds.map((viewId) => ({ size: 1 / viewIds.length, cells: [{ viewId, size: 1 }] })),
        focus: { column: 0, cell: 0 }
    });
    const laterChats = [
        { id: 'later-1', name: 'Later one', node: {} },
        { id: 'later-2', name: 'Later two', node: {} }
    ];
    const canvasView = { kind: 'canvas', id: 'canvas', name: 'Canvas', nodes: [], texts: [], edges: [], layouts: [] } as unknown as ProjectView;
    const designView = { kind: 'design', id: 'design-view', name: 'Design', path: 'design', node: {}, chats: laterChats } as unknown as ProjectView;
    const workspace: NodeSightWorkspace = {
        views: [canvasView, designView],
        layout: layout('canvas', 'design-view'),
        canvasOf: (viewId) =>
            viewId === 'canvas'
                ? {
                      camera: { x: 0, y: 0, zoom: 1 },
                      viewport: { w: 1000, h: 800 },
                      nodes: [
                          { id: 'design-node', kind: 'design', chats: laterChats, x: 100, y: 100, w: 300, h: 300 },
                          { id: 'term', kind: 'terminal', x: 500, y: 100, w: 300, h: 300 }
                      ]
                  }
                : null
    };

    beforeEach(() => {
        useDesignChat.setState({ picked: {} });
    });

    test('a design in sight is the chat it shows, the newest unless a person picked another', () => {
        expect(nodesInSightOf(workspace)).toEqual([['later-2', 'term'], ['later-2']]);
    });

    test('a picked chat is in sight, its siblings behind the picker are not', () => {
        useDesignChat.setState({ picked: { 'design-node': 'later-1', 'design-view': 'design-view' } });

        expect(nodesInSightOf(workspace)).toEqual([['later-1', 'term'], ['design-view']]);
    });
});
