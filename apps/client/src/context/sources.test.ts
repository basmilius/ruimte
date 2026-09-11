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
        readme: node('readme', 'file', { title: 'README.md', path: 'docs/README.md' }),
        outside: node('outside', 'file', { title: 'hosts', path: '/etc/hosts' }),
        frame: node('frame', 'group')
    };
    const texts = { t1: { id: 't1', x: 0, y: 0, text: 'First line\nsecond', size: 18 } };

    test('a file is its path on the daemon machine, never its contents', () => {
        const sources = deriveContextSources(nodes, texts, [{ id: 'e1', from: 'readme', to: 'chat' }], '/home/bas/app');
        expect(sources.get('chat')).toEqual([{ id: 'readme', kind: 'file', title: 'README.md', text: '/home/bas/app/docs/README.md' }]);
    });

    test('a file outside the folder keeps the absolute path it was stored with', () => {
        const sources = deriveContextSources(nodes, texts, [{ id: 'e1', from: 'outside', to: 'chat' }], '/home/bas/app');
        expect(sources.get('chat')).toEqual([{ id: 'outside', kind: 'file', title: 'hosts', text: '/etc/hosts' }]);
    });

    test('a file in a project with no folder falls back to what it stored', () => {
        const sources = deriveContextSources(nodes, texts, [{ id: 'e1', from: 'readme', to: 'chat' }]);
        expect(sources.get('chat')).toEqual([{ id: 'readme', kind: 'file', title: 'README.md', text: 'docs/README.md' }]);
    });

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
