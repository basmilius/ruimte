import { describe, expect, test } from 'bun:test';
import { isCanvasView, type ProjectNode, type ProjectText, type ProjectView } from '@ruimte/contracts';
import fixture from '../../../ios/Tests/Fixtures/view-references.json';
import type { Referable } from '@adecore/agents-react/chat';
import { projectReferables } from '@/chat/referables';

function node(id: string, kind: ProjectNode['kind'], title: string, extra: Partial<ProjectNode> = {}): ProjectNode {
    return { id, kind, title, x: 0, y: 0, w: 100, h: 100, ...extra } as ProjectNode;
}

const BOARD = {
    kind: 'canvas',
    id: 'board',
    name: 'Board',
    nodes: [
        node('chat-here', 'chat', 'Lead'),
        node('note-1', 'note', 'Research'),
        node('sketch-node', 'drawing', 'Sketch', { viewId: 'sketch' }),
        node('group-1', 'group', 'Group'),
        node('remote', 'terminal', 'Elsewhere', { machine: 'machine-b' })
    ],
    texts: [{ id: 'text-1', text: 'Goals\nmore', x: 0, y: 0 }],
    edges: []
} as unknown as ProjectView;

const VIEWS = [
    BOARD,
    { kind: 'separator', id: 'sep' },
    { kind: 'subheader', id: 'sub', name: 'Later' },
    { kind: 'drawing', id: 'sketch', name: 'Sketch' },
    { kind: 'chat', id: 'chat-view', name: 'Research', node: {} },
    { kind: 'chat', id: 'chat-hidden', name: 'Inline edit', node: {}, hidden: true },
    { kind: 'note', id: 'other-note', name: 'Research' }
] as unknown as ProjectView[];

const nodesOf = (view: ProjectView): readonly ProjectNode[] => (isCanvasView(view) ? view.nodes : []);
const textsOf = (view: ProjectView): readonly ProjectText[] => (isCanvasView(view) ? view.texts : []);

describe('projectReferables', () => {
    test('a chat on a canvas gets what stands there first, a drawing node standing for its view', () => {
        expect(projectReferables(VIEWS, nodesOf, textsOf, 'chat-here')).toEqual([
            { id: 'note-1', name: 'Research', kind: 'note', group: 'canvas' },
            { id: 'sketch', name: 'Sketch', kind: 'drawing', group: 'canvas' },
            { id: 'text-1', name: 'Goals', kind: 'text', group: 'canvas' },
            { id: 'board', name: 'Board', kind: 'canvas', group: 'views' },
            { id: 'chat-view', name: 'Research', kind: 'chat', group: 'views' }
        ]);
    });

    test('a chat view gets the views alone, without itself, dividers or hidden chats', () => {
        expect(projectReferables(VIEWS, nodesOf, textsOf, 'chat-view').map((item) => item.id)).toEqual(['board', 'sketch']);
    });

    test('a node with the name and kind of a view is told apart by its canvas', () => {
        const board = { ...BOARD, nodes: [...(BOARD as { nodes: ProjectNode[] }).nodes, node('chat-twin', 'chat', 'Research')] } as ProjectView;
        const items = projectReferables([board, ...VIEWS.slice(1)], nodesOf, textsOf, 'chat-here');
        expect(items.find((item) => item.id === 'chat-twin')?.detail).toBe('Board');
        expect(items.find((item) => item.id === 'chat-view')?.detail).toBeUndefined();
        expect(items.find((item) => item.id === 'note-1')?.detail).toBeUndefined();
    });

    test('a design node is offered as its chat, and a later chat of it gets the canvas its design stands on', () => {
        const design = node('design-1', 'design', 'Landing', { chats: [{ id: 'design-later', name: 'Second pass', node: {} }] });
        const board = { ...BOARD, nodes: [...(BOARD as { nodes: ProjectNode[] }).nodes, design] } as ProjectView;
        const items = projectReferables([board, ...VIEWS.slice(1)], nodesOf, textsOf, 'design-later');
        expect(items.find((item) => item.id === 'design-1')).toEqual({ id: 'design-1', name: 'Landing', kind: 'chat', group: 'canvas' });
        expect(items.find((item) => item.id === 'note-1')?.group).toBe('canvas');
    });
});

describe('the offer the iPhone shares', () => {
    test('is the same list, groups, order and names the iPhone offers for the fixture project', () => {
        const views = fixture.views as unknown as ProjectView[];
        const nodesOf = (view: ProjectView): readonly ProjectNode[] => (isCanvasView(view) ? view.nodes : []);
        const textsOf = (view: ProjectView): readonly ProjectText[] => (isCanvasView(view) ? view.texts : []);
        expect(projectReferables(views, nodesOf, textsOf, fixture.chatId)).toEqual(fixture.referables as Referable[]);
    });
});
