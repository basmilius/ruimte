import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { act } from 'react';
import { useDocument } from '@/state/document';
import { useUi } from '@/state/ui';
import { windowWorkspace } from '@/state/window';
import { menuItem, openCanvasPage, openContextMenu, savedNodes, type CanvasPage } from '../../testing/canvas-page';
import { chatInfoOf } from '../../testing/chat-info';
import { clickOn, openSubmenu, pressKey, until } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { fakeProvider } from '../../testing/fake-provider';

const CLAUDE = fakeProvider('claude', 'Claude Code', { version: '2.1.0', resumeCommand: 'claude --resume {id}' });

const CHAT: ProjectNode = { id: 'fresh-chat', kind: 'chat', provider: 'claude', x: 0, y: 0, w: 480, h: 520 } as ProjectNode;
// A note from before Color covered notes: its old blue paper over an accent nothing painted.
const OLD_NOTE: ProjectNode = {
    id: 'old-note',
    kind: 'note',
    title: 'Old note',
    x: 600,
    y: 0,
    w: 240,
    h: 160,
    body: 'Buy milk',
    color: 'blue',
    accent: 'red'
} as ProjectNode;
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [CHAT, OLD_NOTE], texts: [], edges: [], layouts: [] };
const OTHER: ProjectCanvasView = { ...MAIN, id: 'other', name: 'Other', nodes: [{ ...CHAT, id: 'other-chat', title: 'Other chat' }] };

const OTHER_ROW = '[data-sidebar-row$="node:other:other-chat"]';

let machine: FakeMachine;
let canvas: CanvasPage;

async function openNodeMenu(id: string): Promise<void> {
    await openContextMenu(frameOf(id));
}

function savedNode(id: string): ProjectNode | undefined {
    return savedNodes(machine).find((node) => node.id === id);
}

/* What crosses the wire, where a key set to undefined is gone. */
function sentNode(id: string): Record<string, unknown> {
    return JSON.parse(JSON.stringify(savedNode(id) ?? null)) as Record<string, unknown>;
}

function savedChat(): ProjectNode | undefined {
    return savedNode(CHAT.id);
}

function frameOf(id: string): HTMLElement {
    return canvas.page.host.querySelector(`[data-node-id="${id}"]`)!;
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
    canvas = await openCanvasPage(machine, [MAIN, OTHER], CHAT.id);
    await act(async () => useUi.getState().setSidebarExpanded([OTHER.id]));
    await until(() => canvas.page.host.querySelector(OTHER_ROW) !== null);
});

afterEach(() => canvas.close());

describe('the menu of a chat node', () => {
    test('renaming from an inactive canvas sidebar row keeps the active canvas', async () => {
        await openContextMenu(canvas.page.host.querySelector(OTHER_ROW)!);
        await clickOn(menuItem('Rename'));
        await until(() => document.activeElement instanceof HTMLInputElement);
        const input = document.activeElement as HTMLInputElement;
        input.value = 'Renamed without switching';
        await pressKey(input, 'Enter');
        expect(useDocument.getState().activeViewId).toBe(MAIN.id);
        const other = useDocument.getState().views.find((view) => view.id === OTHER.id);
        expect(other?.kind === 'canvas' && other.nodes.find((node) => node.id === 'other-chat')?.title).toBe('Renamed without switching');
    });

    test('a sidebar row on another canvas offers the node menu and saves to that canvas', async () => {
        await openContextMenu(canvas.page.host.querySelector(OTHER_ROW)!);
        expect(useDocument.getState().activeViewId).toBe(MAIN.id);
        await openSubmenu('Color');
        expect(useDocument.getState().activeViewId).toBe(MAIN.id);
        await clickOn(menuItem('Teal'));
        expect(useDocument.getState().activeViewId).toBe(OTHER.id);
        await act(async () => windowWorkspace()!.connection.projects.flush());
        const saved = machine.requests('project.save').at(-1)?.content.views;
        const other = saved?.find((view) => view.id === OTHER.id);
        expect(other?.kind === 'canvas' && other.nodes?.find((node) => node.id === 'other-chat')?.accent).toBe('teal');
        expect(savedChat()?.accent).toBeUndefined();
    });

    test('a chat that has not run a turn offers no Conversation submenu', async () => {
        await openNodeMenu(CHAT.id);

        expect(menuItem('Rename')).not.toBeNull();
        expect(menuItem('Conversation')).toBeNull();
    });

    test('Color lists the accents by name, like Flag, and picking one saves it on the node', async () => {
        await openNodeMenu(CHAT.id);
        await openSubmenu('Color');

        expect(menuItem('Teal')).not.toBeNull();
        expect(menuItem('None')).not.toBeNull();

        await clickOn(menuItem('Teal'));
        await act(async () => windowWorkspace()!.connection.projects.flush());
        expect(savedChat()?.accent).toBe('teal');
    });
});

describe('the menu of a note', () => {
    test('offers one Color, checked on the paper an old note shows, and no Note color', async () => {
        expect(frameOf(OLD_NOTE.id).dataset.paper).toBe('blue');
        await openNodeMenu(OLD_NOTE.id);

        expect(menuItem('Note color')).toBeNull();
        await openSubmenu('Color');
        // A checked row draws its tick; the dot of a color is no icon.
        expect(menuItem('Blue')?.querySelector('svg')).not.toBeNull();
        expect(menuItem('Red')?.querySelector('svg')).toBeNull();
    });

    test('picking a color paints the paper with it and saves the accent without the old paper', async () => {
        await openNodeMenu(OLD_NOTE.id);
        await openSubmenu('Color');
        await clickOn(menuItem('Teal'));

        await until(() => frameOf(OLD_NOTE.id).dataset.paper === 'teal');
        await act(async () => windowWorkspace()!.connection.projects.flush());
        expect(sentNode(OLD_NOTE.id)).toMatchObject({ accent: 'teal', body: 'Buy milk' });
        expect(sentNode(OLD_NOTE.id)).not.toHaveProperty('color');
    });

    test('None gives the note the default paper, not its old one', async () => {
        await openNodeMenu(OLD_NOTE.id);
        await openSubmenu('Color');
        await clickOn(menuItem('None'));

        await until(() => frameOf(OLD_NOTE.id).dataset.paper === 'yellow');
        await act(async () => windowWorkspace()!.connection.projects.flush());
        expect(sentNode(OLD_NOTE.id)).toMatchObject({ id: OLD_NOTE.id, body: 'Buy milk' });
        expect(sentNode(OLD_NOTE.id)).not.toHaveProperty('accent');
        expect(sentNode(OLD_NOTE.id)).not.toHaveProperty('color');
    });
});
