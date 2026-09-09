import { describe, expect, test } from 'bun:test';
import type { CanvasNode } from '@/state/canvas';
import { deriveContextSources } from './sources';

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

describe('deriveContextSources', () => {
    const nodes = {
        chat: node('chat', 'chat'),
        shell: node('shell', 'terminal'),
        note: node('note', 'note', { title: 'Plan', body: '# Plan\n\nShip it.' }),
        page: node('page', 'browser', { url: 'https://ruimte.app' }),
        frame: node('frame', 'group')
    };
    const texts = { t1: { id: 't1', x: 0, y: 0, text: 'First line\nsecond', size: 18 } };

    test('a note is a text source with its title and body', () => {
        const sources = deriveContextSources(nodes, texts, [{ id: 'e1', from: 'note', to: 'chat' }]);
        expect(sources.get('chat')).toEqual([{ id: 'note', kind: 'text', title: 'Plan', text: '# Plan\n\nShip it.' }]);
    });

    test('only edges into an agent node become context', () => {
        const edges = [
            { id: 'e1', from: 'shell', to: 'note' },
            { id: 'e2', from: 'note', to: 'frame' },
            { id: 'e3', from: 'page', to: 't1' },
            { id: 'e4', from: 't1', to: 'shell' }
        ];
        const sources = deriveContextSources(nodes, texts, edges);
        expect([...sources.keys()]).toEqual(['shell']);
        expect(sources.get('shell')).toEqual([{ id: 't1', kind: 'text', title: 'First line', text: 'First line\nsecond' }]);
    });

    test('a group into an agent is a line only, a browser hands over its address', () => {
        const sources = deriveContextSources(nodes, texts, [
            { id: 'e1', from: 'frame', to: 'chat' },
            { id: 'e2', from: 'page', to: 'chat' }
        ]);
        expect(sources.get('chat')).toEqual([{ id: 'page', kind: 'text', title: 'page', text: 'https://ruimte.app' }]);
    });
});
