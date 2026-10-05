import { describe, expect, test } from 'bun:test';
import type { ProjectView, SplitLayout } from '@ruimte/contracts';
import { chatsOpenHere, chooserChats, chooserSections } from './chat-chooser';

const chatNode = (id: string, title: string, provider?: 'claude' | 'codex') => ({
    id,
    kind: 'chat',
    title,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    ...(provider === undefined ? {} : { provider })
});

const views = [
    {
        kind: 'canvas',
        id: 'main',
        name: 'Main',
        nodes: [
            chatNode('matcher', 'Matcher V2', 'claude'),
            chatNode('ui', 'UI', 'codex'),
            { id: 'shell', kind: 'terminal', title: 'dev', x: 0, y: 0, w: 1, h: 1 }
        ],
        texts: [],
        edges: [],
        layouts: []
    },
    { kind: 'canvas', id: 'other', name: 'Other', nodes: [chatNode('general', 'Algemeen', 'claude')], texts: [], edges: [], layouts: [] },
    { kind: 'chat', id: 'notes', name: 'Release notes', node: { provider: 'codex' } },
    { kind: 'chat', id: 'blank', name: 'Blank', node: {}, empty: true },
    { kind: 'chat', id: 'inline', name: 'Inline edit', node: {}, hidden: true }
] as ProjectView[];

const layoutOf = (...viewIds: string[]): SplitLayout =>
    ({ columns: [{ size: 1, cells: viewIds.map((viewId) => ({ viewId, size: 1 })) }], focus: { column: 0, cell: 0 } }) as SplitLayout;

describe('the chats the chooser lists', () => {
    test('are the chat nodes and chat views with their agent, and leave out an empty chat nobody wrote in and the chat an inline edit runs in', () => {
        expect(chooserChats({ views, canvases: {} })).toEqual([
            { id: 'matcher', title: 'Matcher V2', provider: 'claude' },
            { id: 'ui', title: 'UI', provider: 'codex' },
            { id: 'general', title: 'Algemeen', provider: 'claude' },
            { id: 'notes', title: 'Release notes', provider: 'codex' }
        ]);
    });

    test('take the names a live canvas has now', () => {
        const canvases = { main: [{ id: 'matcher', kind: 'chat', title: 'Matcher V3', provider: 'claude' as const }] };
        expect(chooserChats({ views, canvases } as never)[0]).toEqual({ id: 'matcher', title: 'Matcher V3', provider: 'claude' });
    });
});

describe('the chats open here', () => {
    test('are the chat views and the chat nodes of the canvases in a cell', () => {
        expect([...chatsOpenHere(views, layoutOf('main', 'notes'), {})].sort()).toEqual(['matcher', 'notes', 'ui']);
        expect([...chatsOpenHere(views, null, {})]).toEqual([]);
    });
});

describe('the sections of the chooser', () => {
    const chats = chooserChats({ views, canvases: {} });

    test('put the linked chats first in the order of their lines, then the open ones, then the rest', () => {
        const sections = chooserSections(chats, ['ui', 'matcher'], new Set(['matcher', 'notes']));
        expect(sections.linked.map((chat) => chat.id)).toEqual(['ui', 'matcher']);
        expect(sections.here.map((chat) => chat.id)).toEqual(['notes']);
        expect(sections.others.map((chat) => chat.id)).toEqual(['general']);
    });

    test('list a chat once, and without lines have nothing linked', () => {
        const sections = chooserSections(chats, [], new Set(['ui']));
        expect(sections.linked).toEqual([]);
        expect(sections.here.map((chat) => chat.id)).toEqual(['ui']);
        expect([...sections.here, ...sections.others].map((chat) => chat.id).sort()).toEqual(['general', 'matcher', 'notes', 'ui']);
    });

    test('ignore a linked id that is no chat of the project any more', () => {
        expect(chooserSections(chats, ['gone'], new Set()).linked).toEqual([]);
    });
});
