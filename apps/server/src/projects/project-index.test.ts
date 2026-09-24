import { describe, expect, test } from 'bun:test';
import type { ProjectNode, ProjectView } from '@ruimte/contracts';
import { ProjectIndex } from './project-index.ts';

const node = (id: string, kind: ProjectNode['kind'], extra: Partial<ProjectNode> = {}): ProjectNode => ({
    id,
    kind,
    title: id,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    ...extra
});

const views = (noteBody: string): ProjectView[] => [
    {
        kind: 'canvas',
        id: 'main',
        name: 'Canvas',
        nodes: [node('agent', 'terminal'), node('note', 'note', { title: 'Plan', body: noteBody }), node('readme', 'file', { path: 'README.md' })],
        texts: [],
        edges: [
            { id: 'e1', from: 'note', to: 'agent' },
            { id: 'e2', from: 'readme', to: 'agent' }
        ],
        layouts: []
    },
    { kind: 'chat', id: 'solo-chat', name: 'Chat', node: {} },
    { kind: 'drawing', id: 'sketch', name: 'Sketch' }
];

describe('ProjectIndex', () => {
    test('derives what an agent may read from the document, with file paths resolved against the folder', () => {
        const index = new ProjectIndex();
        index.set('p1', '/repo', { views: views('ship it') });
        expect(index.sourcesFor('agent')).toEqual([
            { id: 'note', kind: 'text', title: 'Plan', text: 'ship it' },
            { id: 'readme', kind: 'file', title: 'readme', text: '/repo/README.md' }
        ]);
        expect(index.sourcesFor('note')).toEqual([]);
        expect(index.sourcesFor('nobody')).toEqual([]);
    });

    test('a linked source carries the flag the person put on it, and a color this version cannot paint is none', () => {
        const index = new ProjectIndex();
        index.set('p1', '/repo', { views: views('x'), flags: { note: 'red', readme: 'ultraviolet' } });
        expect(index.sourcesFor('agent').map((source) => source.flag)).toEqual(['red', undefined]);
        expect(index.flagsOf('p1')).toEqual({ note: 'red', readme: 'ultraviolet' });
    });

    test('a later set replaces what the project said before, and remove forgets it', () => {
        const index = new ProjectIndex();
        index.set('p1', '/repo', { views: views('first') });
        index.set('p1', '/repo', { views: views('second') });
        expect(index.sourcesFor('agent')[0]).toMatchObject({ text: 'second' });
        index.remove('p1');
        expect(index.sourcesFor('agent')).toEqual([]);
        expect(index.has('p1')).toBe(false);
    });

    test('locates a node on its canvas and a session view as a place of its own', () => {
        const index = new ProjectIndex();
        index.set('p1', '/repo', { views: views('x') });
        index.set('p2', '/other', { views: [{ kind: 'terminal', id: 'other-shell', name: 'Shell', node: {} }] });
        expect(index.locate('agent')).toEqual({ projectId: 'p1', folder: '/repo', canvasId: 'main' });
        expect(index.locate('solo-chat')).toEqual({ projectId: 'p1', folder: '/repo', canvasId: null });
        expect(index.locate('other-shell')).toEqual({ projectId: 'p2', folder: '/other', canvasId: null });
        // A drawing view and a canvas are places to look at, not something an agent runs in.
        expect(index.locate('sketch')).toBeNull();
        expect(index.locate('main')).toBeNull();
    });

    test('hands out the canvas a node stands on, lines and all, and nothing for a view of its own', () => {
        const index = new ProjectIndex();
        index.set('p1', '/repo', { views: views('x') });
        expect(index.canvasOf('agent')?.id).toBe('main');
        expect(index.canvasOf('agent')?.edges.map((edge) => edge.id)).toEqual(['e1', 'e2']);
        expect(index.canvasOf('solo-chat')).toBeNull();
        expect(index.canvasOf('nobody')).toBeNull();
    });
});
