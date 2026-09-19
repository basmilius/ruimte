import { afterEach, describe, expect, test } from 'bun:test';
import type { ProjectDocument } from '@ruimte/contracts';
import { useDrafts } from '../chat/drafts';
import { focusedCanvas } from '../state/canvas';
import { useDocument } from '../state/document';
import { askAgentAboutDiagram } from './views';

const document: ProjectDocument = {
    version: 3,
    rev: 1,
    name: 'Atlas',
    color: '#000',
    views: [
        { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] },
        { kind: 'diagram', id: 'flow', name: 'Flow' }
    ]
};

afterEach(() => {
    useDocument.getState().load(null, null);
});

describe('asking an agent to write an empty diagram', () => {
    test('puts the diagram and a chat on the canvas with a line from one into the other, and a first question in the prompt', () => {
        useDocument.getState().load(document, { activeViewId: 'flow', views: {} });
        const chat = askAgentAboutDiagram('flow');

        expect(chat).not.toBeNull();
        expect(useDocument.getState().activeViewId).toBe('main');
        const canvas = focusedCanvas().getState();
        const mirror = Object.values(canvas.nodes).find((node) => node.kind === 'diagram');
        expect(mirror?.viewId).toBe('flow');
        expect(canvas.nodes[chat!]?.kind).toBe('chat');
        expect(canvas.edges).toEqual([expect.objectContaining({ from: mirror!.id, to: chat })]);
        expect(useDrafts.getState().ids).toContain(chat!);
    });

    test('a view that is not a diagram or a drawing asks nothing', () => {
        useDocument.getState().load(document, { activeViewId: 'main', views: {} });
        expect(askAgentAboutDiagram('main')).toBeNull();
    });
});
