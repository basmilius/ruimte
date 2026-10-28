import { describe, expect, test } from 'bun:test';
import type { ProjectNode, ProjectView } from '@ruimte/contracts';
import { ProjectIndex } from './project-index.ts';

function node(id: string, kind: ProjectNode['kind'], extra: Partial<ProjectNode> = {}): ProjectNode {
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

function views(noteBody: string): ProjectView[] {
    return [
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
}

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

    test('shows a node on a canvas and a view of its own, never a hidden chat or an id no project places', () => {
        const index = new ProjectIndex();
        index.set('p1', '/repo', { views: [...views('x'), { kind: 'chat', id: 'inline-chat', name: 'Inline edit', node: {}, hidden: true }] });

        expect(index.shows('agent')).toBe(true);
        expect(index.shows('solo-chat')).toBe(true);
        expect(index.shows('inline-chat')).toBe(false);
        expect(index.shows('removed')).toBe(false);
        expect(index.isHiddenChat('inline-chat')).toBe(true);
        expect(index.isHiddenChat('solo-chat')).toBe(false);
    });

    test('places a design node and its later chats on its canvas, and its folder follows the canvas being shared', () => {
        const index = new ProjectIndex();
        const design = node('board', 'design', { title: 'Pricing', path: 'pricing', chats: [{ id: 'board-2', name: 'Dense', node: {} }] });
        const canvas: ProjectView = {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            nodes: [design, node('readme', 'file', { path: 'README.md' })],
            texts: [],
            edges: [{ id: 'e1', from: 'readme', to: 'board' }],
            layouts: []
        };
        index.set('p1', '/repo', { views: [canvas] });

        const onCanvas = (folder: string) => ({ folder, onCanvas: true });
        expect(index.designOf('board')).toEqual(onCanvas('/repo/.ruimte/private/designs/pricing'));
        expect(index.designOf('board-2')).toEqual(onCanvas('/repo/.ruimte/private/designs/pricing'));
        expect(index.locate('board-2')).toEqual({ projectId: 'p1', folder: '/repo', canvasId: 'main' });
        expect(index.agentSource('board')).toEqual({ id: 'board', kind: 'chat', title: 'Pricing' });
        expect(index.agentSource('board-2')).toEqual({ id: 'board-2', kind: 'chat', title: 'Dense' });
        expect(index.titleFor('board-2')).toBe('Dense');
        expect(index.titleFor('board')).toBe('Pricing');
        expect(index.sessionNodes('p1')).toEqual([
            { id: 'board', kind: 'chat' },
            { id: 'board-2', kind: 'chat' }
        ]);
        // A later chat reads what the line brings its node.
        expect(index.sourcesFor('board-2').map((source) => source.id)).toEqual(['readme']);
        index.set('p1', '/repo', { views: [canvas], shared: ['main'] });
        expect(index.designOf('board')).toEqual(onCanvas('/repo/.ruimte/designs/pricing'));
    });

    test('names the folder of a chat that works on a design, and none for another chat or a node', () => {
        const index = new ProjectIndex();
        index.set('p1', '/repo', {
            views: [
                ...views('x'),
                {
                    kind: 'design',
                    id: 'design',
                    name: 'Onboarding',
                    node: {},
                    path: 'onboarding',
                    chats: [{ id: 'design-2', name: 'Dark mode', node: {} }]
                }
            ]
        });

        const inView = (folder: string) => ({ folder, onCanvas: false });
        expect(index.designOf('design')).toEqual(inView('/repo/.ruimte/private/designs/onboarding'));
        expect(index.designOf('design-2')).toEqual(inView('/repo/.ruimte/private/designs/onboarding'));
        index.set('p1', '/repo', { views: [...index.viewsOf('p1')!], shared: ['design'] });
        expect(index.designOf('design')).toEqual(inView('/repo/.ruimte/designs/onboarding'));
        expect(index.locate('design-2')).toEqual({ projectId: 'p1', folder: '/repo', canvasId: null });
        expect(index.agentSource('design-2')).toEqual({ id: 'design-2', kind: 'chat', title: 'Dark mode' });
        expect(index.titleFor('design-2')).toBe('Dark mode');
        expect(index.designOf('solo-chat')).toBeNull();
        expect(index.designOf('agent')).toBeNull();
        expect(index.designOf('removed')).toBeNull();
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

    test('lists the folder of every project it holds, until the project goes', () => {
        const index = new ProjectIndex();
        index.set('p1', '/repo', { views: views('x') });
        index.set('p2', '/other', { views: views('x') });

        expect(index.folders()).toEqual(['/repo', '/other']);

        index.remove('p1');

        expect(index.folders()).toEqual(['/other']);
    });
});
