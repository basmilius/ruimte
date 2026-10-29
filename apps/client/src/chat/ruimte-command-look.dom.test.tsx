import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ChatInfo, ChatItem, ProjectCanvasView } from '@ruimte/contracts';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { layOutChat, mount, openToolCall, type Mounted } from '../../testing/dom';
import { claudeProvider } from '../../testing/fake-provider';

const CLAUDE = claudeProvider({ chat: true, terminal: true, hooks: true, diffs: 'before-after', slashCommands: true });

const CANVAS: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Feature: Views',
    nodes: [{ id: 'browser-3f2a9k1d', kind: 'browser', title: 'Downloads', x: 0, y: 0, w: 400, h: 300 }],
    texts: [],
    edges: [],
    layouts: []
};

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

function shellCall(id: string, command: string, createdAt: number): ChatItem {
    return {
        id,
        kind: 'tool',
        createdAt,
        turnId: null,
        toolUseId: id,
        name: 'Bash',
        input: { command },
        output: '',
        state: 'done',
        parentToolUseId: null
    } as ChatItem;
}

function reply(id: string, createdAt: number): ChatItem {
    return { id, kind: 'assistant', createdAt, turnId: null, text: 'Done.', streaming: false } as ChatItem;
}

/* The line of a call as a person reads it, its time left out. */
function lineOf(itemId: string): string | null {
    const row = page.host.querySelector(`[data-find-item="${itemId}"]`);
    if (row === null) {
        return null;
    }
    const copy = row.cloneNode(true) as HTMLElement;
    copy.querySelector('time')?.remove();
    return copy.textContent;
}

beforeEach(async () => {
    restoreLayout = layOutChat();
    views += 1;
    chatId = `chat-look${views}`;
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer(
        'chat.attach',
        ({ chatId: attached }) =>
            ({
                info: infoOf(attached),
                items: [
                    shellCall('call-click', 'ruimte-context computer click "Ruimte Dev" --element 438 --state 2>&1 | head', 1),
                    reply('reply-1', 2),
                    shellCall('call-go', 'ruimte-context browser go browser-3f2a9k1d --url https://ruimte.app/download --view main', 3),
                    reply('reply-2', 4),
                    shellCall('call-plain', 'ls -la', 5)
                ],
                seq: 1
            }) as never
    );
    const chat = { kind: 'chat', id: chatId, name: 'Agent', node: { provider: 'claude' } };
    workspace = await openFakeWorkspace(machine, { views: [chat, CANVAS] } as never, { activeViewId: chatId, views: {} });
    page = mount();
    await page.renderApp();
    await openToolCall(page.host, 'call-go');
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    restoreLayout();
});

describe('a ruimte-context call in a chat', () => {
    test('reads as the part of Ruimte it works on, without the program and the shell around it', () => {
        expect(lineOf('call-click')).toBe('Ruimte Computer Useclick "Ruimte Dev" --element 438 --state+ head');
        expect(page.host.querySelector('[data-find-item="call-click"] .font-semibold')?.textContent).toBe('Ruimte');
    });

    test('names a node and a view of the project by their titles, the ids still behind them', () => {
        const line = lineOf('call-go')!;
        expect(line).toStartWith('Ruimte Browsergo Downloads');
        expect(line).toContain('--view Feature: Views');
        expect(line).not.toContain('Bash');
        const hidden = [...page.host.querySelectorAll('[data-find-item="call-go"] .sr-only')].map((element) => element.textContent);
        expect(hidden).toEqual(['browser-3f2a9k1d', 'main']);
    });

    test('any other shell call still reads as Bash', () => {
        expect(lineOf('call-plain')).toBe('Bashls -la');
    });
});
