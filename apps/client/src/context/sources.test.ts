import { describe, expect, test } from 'bun:test';
import type { CanvasNode, Edge, TextElement } from '@/state/canvas';
import { chatsLinkedTo, contextSourcesOf } from './sources';

function node(id: string, kind: CanvasNode['kind'], extra: Partial<CanvasNode> = {}): CanvasNode {
    return {
        id,
        kind,
        title: id,
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        ...extra
    };
}

describe('the context sources of a canvas', () => {
    const nodes: Record<string, CanvasNode> = {
        chat: node('chat', 'chat'),
        note: node('note', 'note', { title: 'Plan', body: 'Ship it.' })
    };
    const texts: Record<string, TextElement> = {};
    const edges: Edge[] = [{ id: 'e1', from: 'note', to: 'chat' }];

    test('are derived once for the same nodes, texts and lines, which is all a pan leaves behind', () => {
        const first = contextSourcesOf(nodes, texts, edges);
        expect(first.get('chat')?.map((source) => source.id)).toEqual(['note']);
        expect(contextSourcesOf(nodes, texts, edges)).toBe(first);
    });

    test('are derived again once any of the three is replaced', () => {
        const first = contextSourcesOf(nodes, texts, edges);
        const unlinked = contextSourcesOf(nodes, texts, []);
        expect(unlinked).not.toBe(first);
        expect(unlinked.get('chat')).toBeUndefined();
        expect(contextSourcesOf({ ...nodes }, texts, edges)).not.toBe(first);
        expect(contextSourcesOf(nodes, { ...texts }, edges)).not.toBe(first);
        expect(contextSourcesOf(nodes, texts, edges)).toBe(first);
    });
});

describe('the chats linked to a node', () => {
    const file = node('file', 'file', { path: 'src/score.ts' });
    const nodes = (...more: CanvasNode[]): Record<string, CanvasNode> =>
        Object.fromEntries([file, node('first', 'chat', { x: 400 }), node('second', 'chat', { x: 800 }), ...more].map((entry) => [entry.id, entry]));

    test('are the chats at the other end of a line, whichever way it was drawn', () => {
        const edges: Edge[] = [
            { id: 'e1', from: 'file', to: 'first' },
            { id: 'e2', from: 'second', to: 'file' }
        ];
        expect(chatsLinkedTo(nodes(), {}, edges, 'file')).toEqual(['first', 'second']);
    });

    test('leave out a chat with no line, and nodes that are not chats', () => {
        const edges: Edge[] = [
            { id: 'e1', from: 'file', to: 'first' },
            { id: 'e2', from: 'file', to: 'shell' }
        ];
        expect(chatsLinkedTo(nodes(node('shell', 'terminal')), {}, edges, 'file')).toEqual(['first']);
        expect(chatsLinkedTo(nodes(), {}, [], 'file')).toEqual([]);
    });

    test('include a chat that a frame around the node is linked to', () => {
        const frame = node('frame', 'group', { x: -20, y: -20, w: 200, h: 200 });
        const edges: Edge[] = [{ id: 'e1', from: 'frame', to: 'second' }];
        expect(chatsLinkedTo(nodes(frame), {}, edges, 'file')).toEqual(['second']);
        expect(chatsLinkedTo(nodes(frame), {}, edges, 'first')).toEqual([]);
    });

    test('include a chat that a terminal reads, and a chat the terminal is read by', () => {
        const shell = node('shell', 'terminal');
        const edges: Edge[] = [
            { id: 'e1', from: 'first', to: 'shell' },
            { id: 'e2', from: 'shell', to: 'second' }
        ];
        expect(chatsLinkedTo(nodes(shell), {}, edges, 'shell')).toEqual(['first', 'second']);
    });
});
