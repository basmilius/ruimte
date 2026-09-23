import { afterEach, describe, expect, test } from 'bun:test';
import type { ProjectDocument } from '@ruimte/contracts';
import { useDrafts } from '../chat/drafts';
import { focusedCanvas } from '../state/canvas';
import { useDocument } from '../state/document';
import { askAgentAboutDiagram, openSessionInKind } from './views';

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
    test('puts the diagram and a chat on the canvas with a line from one into the other, and a first question in the prompt', async () => {
        useDocument.getState().load(document, { activeViewId: 'flow', views: {} });
        const chat = await askAgentAboutDiagram('flow');

        expect(chat).not.toBeNull();
        expect(useDocument.getState().activeViewId).toBe('main');
        const canvas = focusedCanvas().getState();
        const mirror = Object.values(canvas.nodes).find((node) => node.kind === 'diagram');
        expect(mirror?.viewId).toBe('flow');
        expect(canvas.nodes[chat!]?.kind).toBe('chat');
        expect(canvas.edges).toEqual([expect.objectContaining({ from: mirror!.id, to: chat })]);
        expect(useDrafts.getState().ids).toContain(chat!);
    });

    test('a view that is not a diagram or a drawing asks nothing', async () => {
        useDocument.getState().load(document, { activeViewId: 'main', views: {} });
        expect(await askAgentAboutDiagram('main')).toBeNull();
    });
});

describe('the same session in the other kind of view', () => {
    const withChat: ProjectDocument = {
        ...document,
        views: [
            ...document.views,
            { kind: 'chat', id: 'talk', name: 'Claude', node: { provider: 'claude', providerFixed: true } },
            { kind: 'terminal', id: 'shell', name: 'Shell', node: {} }
        ]
    };

    test('a chat opens as a terminal that resumes its session, right under it', () => {
        useDocument.getState().load(withChat, { activeViewId: 'talk', views: {} });
        const id = openSessionInKind('talk', 'terminal', { provider: 'claude', resume: 'sess-1', cwd: '/work' });

        const views = useDocument.getState().views;
        expect(views.map((view) => view.id)).toEqual(['main', 'flow', 'talk', id!, 'shell']);
        const opened = views.find((view) => view.id === id);
        expect(opened).toMatchObject({ kind: 'terminal', name: 'Claude', node: { provider: 'claude', resume: 'sess-1', cwd: '/work' } });
    });

    test('a terminal opens as a chat that cannot be handed to another CLI', () => {
        useDocument.getState().load(withChat, { activeViewId: 'shell', views: {} });
        const id = openSessionInKind('shell', 'chat', { provider: 'codex', resume: 'sess-2' });

        const opened = useDocument.getState().views.find((view) => view.id === id);
        expect(opened).toMatchObject({ kind: 'chat', node: { provider: 'codex', resume: 'sess-2', providerFixed: true } });
    });

    test('a view that is gone opens nothing', () => {
        useDocument.getState().load(withChat, { activeViewId: 'talk', views: {} });
        expect(openSessionInKind('nowhere', 'terminal', { provider: 'claude', resume: 'sess-3' })).toBeNull();
    });
});
