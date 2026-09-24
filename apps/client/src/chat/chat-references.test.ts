import { describe, expect, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';
import { chatSuggestions, projectChats } from './chat-references';

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
        expect(projectChats({ views, canvases: {} })).toEqual([
            { id: 'planner', title: 'Planner' },
            { id: 'notes', title: 'Release notes' }
        ]);
    });

    test('a canvas open in this window names its chats as they are now', () => {
        const live = { main: [{ id: 'planner', kind: 'chat', title: 'Auth rewrite' }] };
        expect(projectChats({ views, canvases: live })[0]).toEqual({ id: 'planner', title: 'Auth rewrite' });
    });
});

describe('chatSuggestions', () => {
    const chats = projectChats({ views, canvases: {} });

    test('matches the query anywhere in the title, whatever its case', () => {
        expect(chatSuggestions(chats, 'NOTE', [], 5)).toEqual([{ id: 'notes', title: 'Release notes' }]);
        expect(chatSuggestions(chats, '', [], 5)).toHaveLength(2);
    });

    test('leaves out the chat typing and the chats already attached, and stops at the limit', () => {
        expect(chatSuggestions(chats, '', ['planner'], 5)).toEqual([{ id: 'notes', title: 'Release notes' }]);
        expect(chatSuggestions(chats, '', [], 1)).toEqual([{ id: 'planner', title: 'Planner' }]);
    });
});
