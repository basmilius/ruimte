import { describe, expect, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';
import { forkOriginIn } from '@/chat/fork-origin';
import { nodesOfView } from '@/state/view-nodes';

describe('the original of a fork', () => {
    test('the original is found as a chat view or a chat node on any canvas, and nowhere once it is gone', () => {
        const views: ProjectView[] = [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [{ id: 'chat-2', kind: 'chat', title: 'Parser', x: 0, y: 0, w: 1, h: 1 }],
                texts: [],
                edges: [],
                layouts: []
            },
            { kind: 'chat', id: 'chat-1', name: 'Lexer', node: {} },
            { kind: 'terminal', id: 'term-1', name: 'Shell', node: {} }
        ];
        expect(forkOriginIn(views, nodesOfView, 'chat-1')).toEqual({ shape: 'view', title: 'Lexer', viewId: null });
        expect(forkOriginIn(views, nodesOfView, 'chat-2')).toEqual({ shape: 'node', title: 'Parser', viewId: 'main' });
        expect(forkOriginIn(views, nodesOfView, 'term-1')).toBeNull();
        expect(forkOriginIn(views, nodesOfView, 'chat-3')).toBeNull();
    });
});
