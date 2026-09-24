import { describe, expect, test } from 'bun:test';
import type { CanvasNode, Edge, TextElement } from '@/state/canvas';
import { contextSourcesOf } from './sources';

const node = (id: string, kind: CanvasNode['kind'], extra: Partial<CanvasNode> = {}): CanvasNode => ({
    id,
    kind,
    title: id,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    ...extra
});

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
