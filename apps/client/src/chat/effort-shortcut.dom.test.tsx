import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProviderInfo } from '@ruimte/contracts';
import { isApplePlatform } from '@/desktop/bridge';
import { focusedCanvas } from '@/state/canvas';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../testing/dom';

const CLAUDE = {
    kind: 'claude',
    name: 'Claude Code',
    installed: true,
    version: '2.1.0',
    models: [
        {
            slug: 'model',
            name: 'Model',
            legacy: false,
            isDefault: true,
            options: [
                {
                    id: 'effort',
                    label: 'Reasoning',
                    type: 'select',
                    defaultChoice: 'medium',
                    choices: [
                        { id: 'low', label: 'Low' },
                        { id: 'medium', label: 'Medium' },
                        { id: 'high', label: 'High' }
                    ]
                }
            ]
        }
    ],
    defaultModel: 'model',
    capabilities: { chat: true, terminal: true, hooks: true, diffs: 'before-after', slashCommands: true },
    resumeCommand: 'claude --resume {id}'
} as unknown as ProviderInfo;

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

// One chat on screen per test, so its composer is the only editor.
function composer(): HTMLElement | null {
    return page.host.querySelector<HTMLElement>('.cm-content');
}

/* The key as a Mac sends it to the composer that has the keyboard: Shift turns the period into `>` and the comma into `<`. */
async function pressInComposer(key: '>' | '<', code: 'Period' | 'Comma'): Promise<void> {
    const apple = isApplePlatform();
    const target = composer()!;
    await act(async () => {
        target.focus();
        target.dispatchEvent(new KeyboardEvent('keydown', { key, code, shiftKey: true, metaKey: apple, ctrlKey: !apple, bubbles: true, cancelable: true }));
    });
}

function fakeMachine(): FakeMachine {
    const fake = new FakeMachine();
    fake.answer('provider.list', () => ({ providers: [CLAUDE] }));
    fake.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
    fake.answer('chat.configure', ({ chatId, selection }) => chatInfoOf(chatId, selection === undefined ? {} : { selection }) as never);
    return fake;
}

async function expectStepsFromComposer(chatId: string): Promise<void> {
    await pressInComposer('>', 'Period');
    await until(() => machine.requests('chat.configure').length === 1);
    expect(machine.requests('chat.configure')[0]).toMatchObject({ chatId, selection: { model: 'model', options: { effort: 'high' } } });

    await pressInComposer('<', 'Comma');
    await until(() => machine.requests('chat.configure').length === 2);
    expect(machine.requests('chat.configure')[1]).toMatchObject({ chatId, selection: { model: 'model', options: { effort: 'medium' } } });
}

describe('the reasoning effort of the chat that has the keyboard', () => {
    test('steps one choice up and down from the composer of a chat view, and the machine is told each step', async () => {
        const chatId = 'chat-effort-view';
        machine = fakeMachine();
        const chat = { kind: 'chat', id: chatId, name: 'Agent', node: { provider: 'claude' } };
        workspace = await openFakeWorkspace(machine, { views: [chat] } as never, { activeViewId: chatId, views: {} });
        page = mount();
        await page.renderApp();
        await until(() => machine.requests('chat.attach').some((request) => request.chatId === chatId));
        await until(() => composer() !== null);

        await expectStepsFromComposer(chatId);
    });

    test('steps one choice up and down from the composer of a chat node on a canvas', async () => {
        const chatId = 'chat-effort-node';
        const main: ProjectCanvasView = {
            kind: 'canvas',
            id: 'main',
            name: 'Main',
            nodes: [{ id: chatId, kind: 'chat', title: 'Agent', provider: 'claude', x: 0, y: 0, w: 560, h: 360 }],
            texts: [],
            edges: [],
            layouts: []
        };
        machine = fakeMachine();
        workspace = await openFakeWorkspace(machine, { views: [main] }, { activeViewId: main.id, views: {} });
        page = mount();
        await page.renderApp();
        await until(() => machine.requests('chat.attach').some((request) => request.chatId === chatId));
        await until(() => composer() !== null);
        // Clicking into the node's body hands it the keyboard.
        await act(async () => focusedCanvas().getState().setBodyFocus(chatId));

        await expectStepsFromComposer(chatId);
    });
});
