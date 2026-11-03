import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ChatInfo, ChatItem, ProjectCanvasView } from '@ruimte/contracts';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, layOutChat, mount, openToolCall, until, type Mounted } from '../../testing/dom';
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

function toolCall(id: string, name: string, input: Record<string, unknown>, output: string, createdAt: number): ChatItem {
    return { id, kind: 'tool', createdAt, turnId: null, toolUseId: id, name, input, output, state: 'done', parentToolUseId: null } as ChatItem;
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
    chatId = `chat-tools${views}`;
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer(
        'chat.attach',
        ({ chatId: attached }) =>
            ({
                info: infoOf(attached),
                items: [
                    toolCall('call-new', 'mcp__ruimte__node_new', { kind: 'note', title: 'Open punten', view: 'main' }, 'note-klvigszm\tnote\tmain', 1),
                    reply('reply-1', 2),
                    toolCall('call-go', 'ruimte/browser_go', { id: 'browser-3f2a9k1d', url: 'https://ruimte.app/download' }, 'went', 3),
                    reply('reply-2', 4),
                    toolCall(
                        'call-note',
                        'mcp__ruimte__notify',
                        { id: 'browser-3f2a9k1d', text: 'Pick it up' },
                        'notified\tbrowser-3f2a9k1d\tnow\tdetail\tDownloads',
                        5
                    ),
                    reply('reply-3', 6),
                    toolCall('call-other', 'mcp__elsewhere__node_new', { kind: 'note' }, '', 7)
                ],
                seq: 1
            }) as never
    );
    const chat = { kind: 'chat', id: chatId, name: 'Agent', node: { provider: 'claude' } };
    workspace = await openFakeWorkspace(machine, { views: [chat, CANVAS] } as never, { activeViewId: chatId, views: {} });
    page = mount();
    await page.renderApp();
    await openToolCall(page.host, 'call-new');
    await openToolCall(page.host, 'call-go');
    await openToolCall(page.host, 'call-other');
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    restoreLayout();
});

describe('a tool of the machine in a chat', () => {
    test('reads as the part of Ruimte it works on, with its fields, in place of the MCP name', () => {
        const line = lineOf('call-new')!;
        expect(line).toBe('Ruimte Canvasnode new kind=note title="Open punten" view=#Feature: Viewsmain');
        expect(page.host.querySelector('[data-find-item="call-new"] .font-semibold')?.textContent).toBe('Ruimte');
        expect(line).not.toContain('mcp__ruimte__node_new');
    });

    test('draws a node it names as the reference chip of a message, in any CLI shape, the id still behind it', () => {
        expect(lineOf('call-go')).toStartWith('Ruimte Browsergo id=Feature: Views#Downloads');
        const chips = [...page.host.querySelectorAll('[data-find-item="call-go"] [data-chip="reference"]')];
        expect(chips.map((chip) => [chip.getAttribute('data-chip-value'), chip.getAttribute('data-chip-name'), chip.getAttribute('role')])).toEqual([
            ['browser-3f2a9k1d', 'Downloads', 'button']
        ]);
        const hidden = [...page.host.querySelectorAll('[data-find-item="call-go"] .sr-only')].map((element) => element.textContent);
        expect(hidden).toEqual(['#', 'browser-3f2a9k1d']);
    });

    test('opens a view it names from its chip, as a message does', async () => {
        const chip = page.host.querySelector('[data-find-item="call-new"] [data-chip="reference"][data-chip-value="main"]');
        await clickOn(chip);
        await until(() => page.host.querySelector('[data-split-cell][data-view-id="main"]') !== null);
    });

    test('a notify reads as the message it sent, to whom and how it went', () => {
        const row = page.host.querySelector('[data-find-item="call-note"]')!;
        expect(row.textContent).toContain('Pick it up');
        expect(row.textContent).toContain('To');
        expect(row.parentElement?.textContent).toContain('Delivered');
        expect(row.textContent).not.toContain('Ruimte Message');
    });

    test("a tool of another server keeps the CLI's name", () => {
        expect(lineOf('call-other')).toStartWith('mcp__elsewhere__node_new');
    });
});
