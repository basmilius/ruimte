import { describe, expect, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';
import { projectChats } from '@/chat/project-chats';
import { nodesOfView } from '@/state/view-nodes';

const views: ProjectView[] = [
    {
        id: 'main',
        name: 'Canvas',
        kind: 'canvas',
        nodes: [
            { id: 'planner', kind: 'chat', title: 'Planner', x: 0, y: 0, w: 400, h: 300 },
            { id: 'shell', kind: 'terminal', title: 'dev server', x: 0, y: 400, w: 400, h: 300 }
        ],
        texts: [],
        edges: [],
        layouts: []
    },
    { id: 'notes', kind: 'chat', name: 'Release notes', node: { provider: 'claude' } }
];

describe('projectChats', () => {
    test('lists chat nodes and chat views, and nothing else', () => {
        expect(projectChats(views, nodesOfView)).toEqual([
            { id: 'planner', title: 'Planner' },
            { id: 'notes', title: 'Release notes' }
        ]);
    });

    test('leaves out the chat an inline edit runs in', () => {
        const withInline: ProjectView[] = [...views, { id: 'inline', kind: 'chat', name: 'Inline edit', node: {}, hidden: true }];

        expect(projectChats(withInline, nodesOfView).map((chat) => chat.id)).toEqual(['planner', 'notes']);
    });

    test('a canvas open in this window names its chats as they are now', () => {
        const live = [{ id: 'planner', kind: 'chat' as const, title: 'Auth rewrite' }];
        expect(projectChats(views, (view) => (view.id === 'main' ? live : nodesOfView(view)))[0]).toEqual({ id: 'planner', title: 'Auth rewrite' });
    });
});
