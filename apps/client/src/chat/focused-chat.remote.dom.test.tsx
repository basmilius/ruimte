import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode, ProviderInfo } from '@ruimte/contracts';
import { useSubagentView } from '@adecore/agents-react/chat';
import { useChats } from '@adecore/agents-react/state';
import { isApplePlatform } from '@/desktop/bridge';
import { runPaletteCommand } from '@/shell/menu/actions';
import { focusedCanvas } from '@/state/canvas';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { endpointKey } from '@/state/keys';
import { chatInfoOf } from '../../testing/chat-info';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../testing/dom';

const REMOTE = 'machine-b';
// The chat runs on the other machine, so every command that means it has to reach that one.
const LEAD: ProjectNode = { id: 'chat-lead', kind: 'chat', title: 'Lexer', machine: REMOTE, x: 0, y: 0, w: 560, h: 640, provider: 'claude' };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [LEAD], texts: [], edges: [], layouts: [] };
const KEY = endpointKey(REMOTE, LEAD.id);

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

const ITEMS = [
    { id: 'turn-1', kind: 'turn', createdAt: 1, turnId: 'turn-1', state: 'done', endedAt: 2, costUsd: 0 },
    { id: 'user-1', kind: 'user', createdAt: 1, turnId: 'turn-1', text: 'Write the lexer' },
    { id: 'turn-2', kind: 'turn', createdAt: 3, turnId: 'turn-2', state: 'done', endedAt: 4, costUsd: 0 },
    { id: 'user-2', kind: 'user', createdAt: 3, turnId: 'turn-2', text: 'Now the parser' }
];

let here: FakeMachine;
let there: FakeMachine;
let workspace: FakeWorkspace;
let disconnectThere: () => void;
let page: Mounted;

function machine(): FakeMachine {
    const fake = new FakeMachine();
    fake.answer('provider.list', () => ({ providers: [CLAUDE] }));
    fake.answer('chat.configure', ({ chatId, selection }) => chatInfoOf(chatId, selection === undefined ? {} : { selection }) as never);
    return fake;
}

function composer(): HTMLElement | null {
    return page.host.querySelector<HTMLElement>('.cm-content');
}

function thread(): HTMLElement {
    return page.host.querySelector<HTMLElement>(`[data-node-id="${LEAD.id}"] .chat-scroll`)!;
}

/* Dispatches the key at `target` the way a browser does and says whether something on the page took it. */
async function press(target: HTMLElement, init: KeyboardEventInit): Promise<boolean> {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    await act(async () => {
        target.dispatchEvent(event);
    });
    return event.defaultPrevented;
}

beforeEach(async () => {
    here = machine();
    there = machine();
    there.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: ITEMS, seq: 2 }) as never);
    useEndpoints.getState().add({
        id: REMOTE,
        label: 'MacBook Pro',
        httpBaseUrl: 'http://127.0.0.1:2',
        wsBaseUrl: 'ws://127.0.0.1:2',
        reachability: 'lan',
        daemonId: null,
        daemonPublicKey: null
    });
    disconnectThere = connectFakeMachine(there, REMOTE);
    workspace = await openFakeWorkspace(here, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => Object.values(useChats.getState().byKey).some((row) => row.structure?.['user-2'] !== undefined));
    await until(() => composer() !== null);
    // Clicking into the node's body hands it the keyboard.
    await act(async () => focusedCanvas().getState().setBodyFocus(LEAD.id));
});

afterEach(async () => {
    await act(async () => useSubagentView.getState().show(KEY, []));
    await page.unmount();
    workspace.close();
    disconnectThere();
    useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
    useEndpoints.getState().remove(REMOTE);
});

describe('the commands that act on a focused chat that runs on another machine', () => {
    test('the reasoning effort key in its composer tells that machine', async () => {
        const apple = isApplePlatform();
        composer()!.focus();
        await press(composer()!, { key: '>', code: 'Period', shiftKey: true, metaKey: apple, ctrlKey: !apple });

        await until(() => there.requests('chat.configure').length === 1);
        expect(there.requests('chat.configure')[0]).toMatchObject({ chatId: LEAD.id, selection: { options: { effort: 'high' } } });
        expect(here.requests('chat.configure')).toEqual([]);
    });

    test('Escape in its thread goes back from the sub-agent it shows', async () => {
        await act(async () => useSubagentView.getState().show(KEY, [{ toolUseId: 'tool-1', description: 'Read the grammar' }]));

        expect(await press(thread(), { key: 'Escape', code: 'Escape' })).toBe(true);
        expect(useSubagentView.getState().trails[KEY]).toBeUndefined();
    });

    test('Alt+Down in its thread steps to a message, the composer keeps the key, and the menu row steps from there', async () => {
        const scrolls: unknown[] = [];
        thread().scrollTo = ((options: ScrollToOptions) => scrolls.push(options)) as never;

        expect(await press(thread(), { key: 'ArrowDown', code: 'ArrowDown', altKey: true })).toBe(true);
        expect(scrolls).toHaveLength(1);

        composer()!.focus();
        expect(await press(composer()!, { key: 'ArrowDown', code: 'ArrowDown', altKey: true })).toBe(false);
        expect(scrolls).toHaveLength(1);

        // A click on the menu row runs the palette's.
        await act(async () => runPaletteCommand('chat-message-next'));
        expect(scrolls).toHaveLength(2);
    });
});
