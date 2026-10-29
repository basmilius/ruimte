import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ChatInfo, ChatItem } from '@ruimte/contracts';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, layOutChat, mount, openToolCall, until, type Mounted } from '../../testing/dom';
import { claudeProvider } from '../../testing/fake-provider';

const CLAUDE = claudeProvider({ chat: true, terminal: true, hooks: true, diffs: 'before-after', slashCommands: true });

const PREVIEW = 'first line of the build\n';
const REST = 'the line the thread did not keep\n';

// A chat view per test, named apart from the last test's, so no row of one test is in the next.
let views = 0;
let chatId: string;
let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let restoreLayout: () => void;

function infoOf(id: string): ChatInfo {
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
        usage: { turns: 1, contextTokens: 0, contextWindow: 200_000, costUsd: 0 },
        background: []
    } as unknown as ChatInfo;
}

function storedBuild(): ChatItem {
    return {
        id: 'build',
        kind: 'tool',
        createdAt: 1,
        turnId: null,
        toolUseId: 'build',
        name: 'Bash',
        input: { command: 'make' },
        output: PREVIEW,
        state: 'done',
        parentToolUseId: null,
        outputRef: { id: 'a'.repeat(64), bytes: 3 * 1024 * 1024 }
    } as ChatItem;
}

function buttonWithText(label: string): HTMLElement | null {
    return ([...page.host.querySelectorAll('button')] as HTMLElement[]).find((button) => button.textContent?.trim() === label) ?? null;
}

async function openChat(): Promise<void> {
    const chat = { kind: 'chat', id: chatId, name: 'Agent', node: { provider: 'claude' } };
    workspace = await openFakeWorkspace(machine, { views: [chat] } as never, { activeViewId: chatId, views: {} });
    page = mount();
    await page.renderApp();
    await openToolCall(page.host, 'build');
}

/* Opens the call's row when the thread draws it folded, so its output is on screen. */
async function showOutput(): Promise<void> {
    if (!page.host.textContent?.includes(PREVIEW.trim())) {
        await clickOn(page.host.querySelector('[data-find-item="build"] button'));
    }

    await until(() => page.host.textContent?.includes(PREVIEW.trim()) === true);
}

beforeEach(() => {
    restoreLayout = layOutChat();
    views += 1;
    chatId = `chat-output-whole${views}`;
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer('chat.attach', ({ chatId: attached }) => ({ info: infoOf(attached), items: [storedBuild()], seq: 1 }) as never);
    machine.answer('chat.toolOutput', () => ({ output: `${PREVIEW}${REST}` }));
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    restoreLayout();
});

describe('a tool output the thread keeps only the beginning of', () => {
    test('loads whole from the chat machine once a person asks', async () => {
        await openChat();
        await showOutput();
        expect(page.host.textContent).not.toContain(REST.trim());

        await clickOn(buttonWithText('Show full output'));
        await until(() => page.host.textContent?.includes(REST.trim()) === true);
        expect(machine.requests('chat.toolOutput')).toEqual([{ chatId, itemId: 'build' }]);
        expect(buttonWithText('Show full output')).toBeNull();
    });

    test('is never asked of a machine that does not answer it', async () => {
        machine.answersOnly(['provider.list', 'chat.attach', 'chat.detach', 'project.open', 'endpoint.info']);
        await openChat();
        await showOutput();

        await clickOn(buttonWithText('Show full output'));
        await until(() => buttonWithText('Try again') !== null);
        expect(machine.requests('chat.toolOutput')).toEqual([]);
        expect(page.host.textContent).toContain(PREVIEW.trim());
    });
});
