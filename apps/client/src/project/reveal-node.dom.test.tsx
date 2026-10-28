import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { useDesignChat } from '@/design/design-chat';
import { revealNode } from '@/project/views';
import { focusedCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { chatInfoOf } from '../../testing/chat-info';
import { layOutChat, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const BOARD: ProjectNode = {
    id: 'board',
    kind: 'design',
    title: 'Pricing',
    titleSource: 'user',
    x: 0,
    y: 0,
    w: 480,
    h: 640,
    provider: 'claude',
    path: 'pricing',
    chats: [
        { id: 'board-2', name: 'Dense', node: { provider: 'claude' } },
        { id: 'board-3', name: 'Wide', node: { provider: 'claude' } }
    ]
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let mounted: Mounted;
let restoreLayout: () => void;

beforeEach(async () => {
    localStorage.clear();
    useDesignChat.setState({ picked: {}, pages: {} });
    restoreLayout = layOutChat();
    machine = new FakeMachine();
    machine.answer('fs.list', ({ path }) => ({ path, entries: [], truncated: false }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    const main: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };
    const studio: ProjectCanvasView = { kind: 'canvas', id: 'studio', name: 'Studio', nodes: [BOARD], texts: [], edges: [], layouts: [] };
    workspace = await openFakeWorkspace(machine, { views: [main, studio] }, { activeViewId: main.id, views: {} });
    mounted = mount();
    await mounted.renderApp();
});

afterEach(async () => {
    await mounted.unmount();
    workspace.close();
    restoreLayout();
});

function shownChat(): Element | null {
    return mounted.host.querySelector('[data-node-id="board"] [aria-label="Chat: Dense"]');
}

test('going to a later chat of a design node, as a notification does, opens its canvas on the node with that chat in front', async () => {
    await act(async () => revealNode('board-2'));

    await until(() => useDocument.getState().activeViewId === 'studio' && shownChat() !== null);
    await until(() => focusedCanvas().getState().selection.includes('board'));
    expect(focusedCanvas().getState().selection).toEqual(['board']);
});
