import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ChatInfo, ChatItem } from '@ruimte/contracts';
import { act } from 'react';
import { clickOn, layOutChat, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { claudeProvider } from '../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const CLAUDE = claudeProvider({ chat: true, terminal: true, hooks: true, diffs: 'before-after', slashCommands: true, compaction: 'prompt' });

// A chat view per test, named apart from the last test's, so no row of one test is in the next.
let views = 0;
let chatId: string;
let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let restoreLayout: () => void;

function infoOf(id: string, usage: Partial<ChatInfo['usage']>): ChatInfo {
    return {
        chatId: id,
        createdAt: 0,
        provider: 'claude',
        cwd: '/work/atlas',
        agentSessionId: null,
        model: null,
        selection: { model: 'model', options: {} },
        runtimeMode: 'supervised',
        status: 'idle',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { turns: 3, contextTokens: 150_000, contextWindow: 200_000, costUsd: 0, ...usage },
        background: []
    } as unknown as ChatInfo;
}

const THREAD: ChatItem[] = [
    { id: 'user-1', kind: 'user', createdAt: 1, turnId: 'turn-1', text: 'Read the whole repository' } as ChatItem,
    { id: 'reply-1', kind: 'assistant', createdAt: 2, turnId: 'turn-1', text: 'Done reading.', streaming: false } as ChatItem
];

async function openChat(): Promise<void> {
    const chat = { kind: 'chat', id: chatId, name: 'Agent', node: { provider: 'claude' } };
    workspace = await openFakeWorkspace(machine, { views: [chat] } as never, { activeViewId: chatId, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => page.host.textContent?.includes('Done reading.') === true);
}

async function contextGroup(): Promise<string> {
    const trigger = [...page.host.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"]')].find((button) => button.querySelector('svg circle') !== null);
    await clickOn(trigger ?? null);
    await until(() => document.body.textContent?.includes('Compact now') === true);

    return document.body.textContent ?? '';
}

beforeEach(() => {
    restoreLayout = layOutChat();
    views += 1;
    chatId = `chat-compaction-meter${views}`;
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer('chat.attach', ({ chatId: attached }) => ({ info: infoOf(attached, {}), items: THREAD, seq: 2 }) as never);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    restoreLayout();
});

describe('a compaction', () => {
    test('shows the size after the fold in the thread and the meter, without another message', async () => {
        await openChat();

        await act(async () => {
            machine.emit('chat.event', {
                chatId,
                event: { type: 'item', item: { id: 'compaction-1', kind: 'compaction', createdAt: 3, turnId: 'turn-2', preTokens: 150_000, postTokens: 8603 } },
                seq: 3
            });
            machine.emit('chat.event', { chatId, event: { type: 'info', info: infoOf(chatId, { contextTokens: 8603 }) }, seq: 4 });
        });

        await until(() => /Context compacted from 150K to 8.6K tokens/.test(page.host.textContent ?? ''));
        expect(await contextGroup()).toMatch(/8\.6K of 200K/);
    });

    test('without a size says it is known after the next reply rather than an empty context', async () => {
        await openChat();

        await act(async () => {
            machine.emit('chat.event', {
                chatId,
                event: { type: 'item', item: { id: 'compaction-1', kind: 'compaction', createdAt: 3, turnId: 'turn-2', preTokens: 150_000 } },
                seq: 3
            });
            machine.emit('chat.event', { chatId, event: { type: 'info', info: infoOf(chatId, { contextTokens: 0, contextPending: true }) }, seq: 4 });
        });

        await until(() => page.host.textContent?.includes('Context compacted from 150K tokens') === true);

        const group = await contextGroup();

        expect(group).toContain('Size known after the next reply');
        expect(group).not.toContain('0 of 200K');
    });
});
