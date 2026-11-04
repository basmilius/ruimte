import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ChatItem, ProviderInfo } from '@ruimte/contracts';
import { chatInfoOf } from '../../testing/chat-info';
import { mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

// A CLI a newer machine offers and this client has no word, mark or color for.
const FUTURE = {
    kind: 'future-cli',
    name: 'Future CLI',
    installed: true,
    version: '1.0.0',
    models: [{ slug: 'default', name: 'Default', legacy: false, isDefault: true, options: [] }],
    defaultModel: 'default',
    capabilities: {
        chat: true,
        terminal: false,
        hooks: false,
        streamsToolOutput: false,
        diffs: 'before-after',
        attachments: true,
        mentions: true,
        denyReason: false,
        allowAlways: true,
        asyncQuestions: false,
        compaction: 'none',
        reportsCost: false,
        reportsContextWindow: false,
        reportsThinking: true,
        slashCommands: true
    },
    resumeCommand: ''
} as unknown as ProviderInfo;

const REPLY: ChatItem = { id: 'item-1', kind: 'assistant', turnId: 'turn-1', text: 'Answered.', streaming: false, createdAt: 0 };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [FUTURE] }));
    machine.answer(
        'chat.attach',
        ({ chatId }) =>
            ({ info: chatInfoOf(chatId, { provider: 'future-cli', selection: { model: 'default', options: {} } }), items: [REPLY], seq: 1 }) as never
    );
    const views = [{ kind: 'chat', id: 'chat-future', name: 'Future', node: { provider: 'future-cli' } }];
    workspace = await openFakeWorkspace(machine, { views } as never, { activeViewId: 'chat-future', views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('a chat of a kind this client does not know', () => {
    test('opens its chat and draws a composer with the model the machine named', async () => {
        await until(() => page.host.querySelector('[data-split-cell][data-view-id="chat-future"] .cm-content') !== null);
        expect(machine.requests('chat.attach')).toEqual([expect.objectContaining({ chatId: 'chat-future' })]);
        expect(page.host.querySelector('[data-split-cell][data-view-id="chat-future"]')?.textContent).toContain('Default');
    });
});
