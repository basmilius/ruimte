import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { usePetSettings } from '@extensions/pets/client/pet-settings';
import type { AgentInfo, AgentStatus, ProjectView } from '@ruimte/contracts';
import { act } from 'react';
import { useSessions } from '@/state/sessions';
import { chatInfoOf } from '../../testing/chat-info';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { claudeProvider } from '../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

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
    usePetSettings.getState().update({ pets: true, petsPlace: 'nodes', petsSets: ['buddies'], petsVisitor: true, petsSubagents: true, petsInViews: true });
});

afterEach(() => {
    usePetSettings.getState().update({ pets: false, petsInViews: true });
});

async function openViews(views: ProjectView[]): Promise<{ workspace: FakeWorkspace; page: Mounted }> {
    const workspace = await openFakeWorkspace(machine, { views } as never, { activeViewId: views[0].id, views: {} });
    const page = mount();
    await page.renderApp();
    // A terminal hears its status only once its lazy view attached, which the first test of a run waits for.
    const terminals = views.filter((view) => view.kind === 'terminal');
    await until(() =>
        terminals.every((view) => Object.entries(useSessions.getState().byKey).some(([key, session]) => key.endsWith(`:${view.id}`) && session.attached))
    );

    return { workspace, page };
}

describe('a terminal in a view of its own', () => {
    let opened: { workspace: FakeWorkspace; page: Mounted } | undefined;

    afterEach(async () => {
        await opened?.page.unmount();
        opened?.workspace.close();
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

        await act(async () => usePetSettings.getState().update({ petsInViews: false }));
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

describe('a chat in a view of its own', () => {
    const CHAT: ProjectView = { kind: 'chat', id: 'writer-view', name: 'Writer', node: { provider: 'claude' } };
    let opened: { workspace: FakeWorkspace; page: Mounted } | undefined;
    const measure = HTMLElement.prototype.getBoundingClientRect;

    afterEach(async () => {
        HTMLElement.prototype.getBoundingClientRect = measure;
        await opened?.page.unmount();
        opened?.workspace.close();
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
