import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { act } from 'react';
import { liveCanvas } from '@/state/canvas';
import { windowWorkspace } from '@/transport/window';
import { chatInfoOf } from '../../testing/chat-info';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { claudeProvider, fakeProvider } from '../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let mounted: Mounted;

beforeEach(async () => {
    localStorage.clear();
    machine = new FakeMachine();
    machine.answer(
        'provider.list',
        () => ({ providers: [claudeProvider(), fakeProvider('codex', 'Codex', { capabilities: { chat: true, terminal: false } } as never)] }) as never
    );
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    mounted = mount();
    await mounted.renderApp();
    await until(() => liveCanvas('main') !== null);
    await act(async () => liveCanvas('main')!.setViewport({ w: 1280, h: 800 }));
    await until(() => ghost('Chat') !== null && button('Codex') !== null);
});

afterEach(async () => {
    await mounted.unmount();
    workspace.close();
});

function ghost(title: string): HTMLElement | null {
    return mounted.host.querySelector<HTMLElement>(`[data-ghost] > button[aria-label="${title}"]`);
}

function button(label: string): HTMLElement | null {
    return mounted.host.querySelector<HTMLElement>(`[data-ghost] button[aria-label="${label}"]`);
}

/* The first node of the canvas as the machine was asked to save it. */
async function savedNode(): Promise<ProjectNode | undefined> {
    await until(() => Object.keys(liveCanvas('main')!.nodes).length === 1);
    await act(async () => windowWorkspace()!.connection.projects.flush());
    await until(() => machine.requests('project.save').length > 0);
    const view = machine
        .requests('project.save')
        .at(-1)
        ?.content.views.find((candidate) => candidate.id === 'main');
    return view?.kind === 'canvas' ? view.nodes[0] : undefined;
}

describe('an empty canvas', () => {
    test('shows a ghost of a chat, a terminal, a browser and a note, each with the key that adds it', async () => {
        const titles = [...mounted.host.querySelectorAll('[data-ghost]')].map((each) => each.querySelector('.font-medium')?.textContent);
        const keys = [...mounted.host.querySelectorAll('[data-ghost] kbd')].map((key) => key.textContent);

        expect(titles).toEqual(['Chat', 'Terminal', 'Browser', 'Note']);
        expect(keys).toHaveLength(4);
        expect(mounted.host.textContent).toContain('Pick an agent to start');
        expect(mounted.host.textContent).toContain('Drop files, right-click for more, or press');
        // Codex chats but does not run in a terminal.
        expect(button('Codex')).not.toBeNull();
        expect(button('Claude Code in a terminal')).not.toBeNull();
        expect(button('Codex in a terminal')).toBeNull();
    });

    test('names the agent and its model while a person points at it', async () => {
        await act(async () => {
            button('Codex')!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
            button('Codex')!.focus();
        });

        expect(mounted.host.textContent).toContain('Codex Model');
        expect(mounted.host.textContent).not.toContain('Pick an agent to start');
    });

    test('adds a chat with the agent a person picks, ready to be typed in, and the ghosts go', async () => {
        await clickOn(button('Codex'));

        expect(await savedNode()).toMatchObject({ kind: 'chat', provider: 'codex' });
        await until(() => mounted.host.querySelector('[data-node-active]') !== null);
        await until(() => mounted.host.querySelector('[data-ghost]') === null);
    });

    test("adds the terminal agent a person picks from the terminal's ghost", async () => {
        await clickOn(button('Claude Code in a terminal'));

        expect(await savedNode()).toMatchObject({ kind: 'terminal', provider: 'claude' });
    });

    test('adds a browser from its ghost', async () => {
        await clickOn(ghost('Browser'));

        expect((await savedNode())?.kind).toBe('browser');
    });
});
