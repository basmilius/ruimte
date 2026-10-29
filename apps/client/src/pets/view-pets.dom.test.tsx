import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { AgentInfo, AgentStatus, ProjectCanvasView, ProjectNode, ProjectView } from '@ruimte/contracts';
import { startPageHolds } from '@/browser/page-hold';
import { canvasOfNode } from '@/state/canvas';
import { useSettings } from '@/state/settings';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';
import { claudeProvider } from '../../testing/fake-provider';

const SHELL: ProjectView = { kind: 'terminal', id: 'shell-view', name: 'Tests', node: {} };

let machine: FakeMachine;

function agent(status: AgentStatus): AgentInfo {
    return { kind: 'codex', agentSessionId: 'a1', transcriptPath: null, status, live: true, updatedAt: 0 };
}

function viewPet(id: string): HTMLElement | null {
    return document.querySelector(`[data-view-pet="${id}"]`);
}

beforeEach(() => {
    machine = new FakeMachine();
    useSettings.getState().update({ pets: true, petsPlace: 'nodes', petsSets: ['buddies'], petsVisitor: true, petsSubagents: true, petsInViews: true });
});

afterEach(() => {
    useSettings.getState().update({ pets: false, petsInViews: true });
});

/* A workspace with these views, the first of them in front, drawn as a person sees it. */
async function openViews(views: ProjectView[]): Promise<{ workspace: FakeWorkspace; page: Mounted }> {
    const workspace = await openFakeWorkspace(machine, { views } as never, { activeViewId: views[0].id, views: {} });
    const page = mount();
    await page.renderApp();

    return { workspace, page };
}

describe('a terminal in a view of its own', () => {
    let opened: { workspace: FakeWorkspace; page: Mounted };

    afterEach(async () => {
        await opened.page.unmount();
        opened.workspace.close();
    });

    test('has its pet in the bar over its text while an agent runs in it, until a person turns pets in views off', async () => {
        opened = await openViews([SHELL]);
        expect(viewPet(SHELL.id)).toBeNull();

        await act(async () => machine.emit('session.status', { sessionId: SHELL.id, agent: agent('running') }));
        await until(() => viewPet(SHELL.id) !== null);
        expect(viewPet(SHELL.id)?.closest('[data-cell-bar]')).not.toBeNull();
        expect(viewPet(SHELL.id)?.getAttribute('aria-label')).toBe('Type in Tests');

        await act(async () => machine.emit('session.status', { sessionId: SHELL.id, agent: agent('needs-you') }));
        await until(() => viewPet(SHELL.id)?.getAttribute('aria-label') === 'Tests needs you');

        // Turned off, it beams out first, a picture that takes no press.
        await act(async () => useSettings.getState().update({ petsInViews: false }));
        await until(() => viewPet(SHELL.id) === null);
        expect(document.querySelector('[data-cell-bar] [data-pet-leaving]')).not.toBeNull();
    });

    test('beams its pet out when the agent in it ends, a picture that no longer takes a press', async () => {
        opened = await openViews([SHELL]);
        await act(async () => machine.emit('session.status', { sessionId: SHELL.id, agent: agent('running') }));
        await until(() => viewPet(SHELL.id) !== null);

        await act(async () => machine.emit('session.status', { sessionId: SHELL.id, agent: null }));
        await until(() => viewPet(SHELL.id) === null);
        expect(document.querySelector('[data-cell-bar] [data-pet-leaving]')).not.toBeNull();
    });
});

describe('a pet on a canvas', () => {
    const WRITER: ProjectNode = { id: 'writer', kind: 'chat', title: 'Writer', x: 100, y: 200, w: 480, h: 400 };
    const SHOP: ProjectNode = { id: 'shop', kind: 'browser', title: 'Shop', x: 800, y: 200, w: 480, h: 400 };
    const MAIN: ProjectCanvasView = {
        kind: 'canvas',
        id: 'main',
        name: 'Main',
        nodes: [WRITER, SHOP],
        texts: [],
        edges: [{ id: 'e1', from: WRITER.id, to: SHOP.id, role: 'target' }],
        layouts: []
    };
    let canvas: CanvasPage;

    afterEach(async () => {
        await canvas.close();
    });

    function standsOn(): string | null {
        return document.querySelector(`[data-pet-box="${WRITER.id}"]`)?.getAttribute('data-pet-on') ?? null;
    }

    test('walks over the line to a page its agent works in, and home when it waits on you', async () => {
        canvas = await openCanvasPage(machine, [MAIN], WRITER.id);

        await act(async () => {
            canvasOfNode(WRITER.id)?.getState().setViewport({ w: 1600, h: 900 });
            canvasOfNode(WRITER.id)?.getState().setCamera({ x: 0, y: 0, zoom: 1 });
            machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id, { status: 'running' }) });
        });

        await until(() => document.querySelector(`[data-pet="${WRITER.id}"]`) !== null);
        expect(standsOn()).toBeNull();

        // The machine asks the page through this client, which `main.tsx` listens for in the app.
        const stopHolds = startPageHolds();
        await act(async () => machine.emit('browser.drive', { askId: 'ask-1', browserId: SHOP.id, action: { kind: 'text' } }));
        await until(() => standsOn() === SHOP.id);
        stopHolds();

        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id, { status: 'needs-you' }) }));
        await until(() => standsOn() === null);
    });
});

describe('a chat in a view of its own', () => {
    const CHAT: ProjectView = { kind: 'chat', id: 'writer-view', name: 'Writer', node: { provider: 'claude' } };
    let opened: { workspace: FakeWorkspace; page: Mounted };
    const measure = HTMLElement.prototype.getBoundingClientRect;

    afterEach(async () => {
        HTMLElement.prototype.getBoundingClientRect = measure;
        await opened.page.unmount();
        opened.workspace.close();
    });

    test('has its pet on the composer, and a press on it hands the keyboard to the composer', async () => {
        // The page draws no layout here, so every box measures as a wide composer column.
        HTMLElement.prototype.getBoundingClientRect = () =>
            ({ x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 120, width: 640, height: 120, toJSON: () => ({}) }) as DOMRect;
        machine.answer('provider.list', () => ({ providers: [claudeProvider({ chat: true, terminal: true, hooks: true })] }));
        machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
        opened = await openViews([CHAT]);
        const button = (): HTMLElement | null => document.querySelector(`[data-pet="${CHAT.id}"]`);
        await until(() => button() !== null);
        expect(button()?.getAttribute('aria-label')).toBe('Write to Writer');

        await clickOn(button());
        expect(document.activeElement?.closest('.composer-input')).not.toBeNull();
    });
});
