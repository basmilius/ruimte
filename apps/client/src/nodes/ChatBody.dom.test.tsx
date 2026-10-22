import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { EditorView } from '@codemirror/view';
import type { ChatInfo, ProviderInfo } from '@ruimte/contracts';
import { useDocument } from '@/state/document';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { isApplePlatform } from '@/desktop/bridge';
import { clickOn, mount, pressKey, until, type Mounted } from '../../testing/dom';

const CLAUDE = {
    kind: 'claude',
    name: 'Claude Code',
    installed: true,
    version: '2.1.0',
    models: [{ slug: 'model', name: 'Model', legacy: false, isDefault: true, options: [] }],
    defaultModel: 'model',
    capabilities: {
        chat: true,
        terminal: true,
        hooks: true,
        streamsToolOutput: false,
        diffs: 'before-after',
        attachments: true,
        mentions: true,
        denyReason: true,
        allowAlways: true,
        asyncQuestions: false,
        compaction: 'none',
        reportsCost: false,
        reportsContextWindow: false,
        reportsThinking: false,
        slashCommands: true,
        steer: false
    },
    resumeCommand: 'claude --resume {id}'
} as unknown as ProviderInfo;

// Three chat views per test, named apart from the last test's, so no draft or row of one test is in the next.
let views = 0;
let first: string;
let second: string;
let third: string;

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let seq = 0;

/* The composer of a view on screen, or null while its chat has not opened. */
function composer(viewId: string): EditorView | null {
    const content = page.host.querySelector(`[data-split-cell][data-view-id="${viewId}"] .cm-content`);
    return content === null ? null : EditorView.findFromDOM(content as HTMLElement);
}

function text(viewId: string): string {
    return composer(viewId)!.state.doc.toString();
}

/* What the editor gets when a person types, without the layout a browser would measure first. */
async function type(viewId: string, words: string): Promise<void> {
    await act(async () => {
        const view = composer(viewId)!;
        view.dispatch(view.state.replaceSelection(words), { userEvent: 'input.type' });
    });
}

function button(label: string): Element | null {
    return page.host.querySelector(`[aria-label="${label}"]`);
}

/* Puts a view in front of the window's one cell, the way picking its tab does. */
async function showView(viewId: string): Promise<void> {
    await act(async () => useDocument.getState().setActiveView(viewId));
    await until(() => composer(viewId) !== null);
}

/* What the machine says about a chat as it changes, the way its stream does. */
function tell(chatId: string, patch: Partial<ChatInfo>): void {
    seq += 1;
    act(() => machine.emit('chat.event', { chatId, event: { type: 'info', info: chatInfoOf(chatId, patch) }, seq }));
}

beforeEach(async () => {
    views += 3;
    first = `chat-${views - 2}`;
    second = `chat-${views - 1}`;
    third = `chat-${views}`;
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq }) as never);
    machine.answer('chat.send', () => ({ queued: false, turnId: 'turn-1' }));
    const chats = [
        { kind: 'chat', id: first, name: 'First', node: { provider: 'claude' } },
        { kind: 'chat', id: second, name: 'Second', node: { provider: 'claude' } },
        { kind: 'chat', id: third, name: 'Third', node: { provider: 'claude' } }
    ];
    workspace = await openFakeWorkspace(machine, { views: chats } as never, { activeViewId: first, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => composer(first) !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('a chat view', () => {
    test('Enter sends what was typed to the machine and empties the box', async () => {
        await type(first, 'Look at the failing test');
        await pressKey(composer(first)!.contentDOM, 'Enter');
        await until(() => machine.requests('chat.send').length === 1);
        expect(machine.requests('chat.send')[0]).toMatchObject({ chatId: first, text: 'Look at the failing test', delivery: 'queue' });
        expect(text(first)).toBe('');
    });

    test('a message typed during a turn waits in the queue, and Send now sends it ahead', async () => {
        machine.answer('chat.send', () => ({ queued: true }));
        tell(first, { status: 'running', running: true, activeTurnId: 'turn-1' });
        await type(first, 'Also check the docs');
        await clickOn(button('Queue'));
        await until(() => machine.requests('chat.send').length === 1);
        expect(machine.requests('chat.send')[0]).toMatchObject({ chatId: first, text: 'Also check the docs', delivery: 'queue' });
        tell(first, { status: 'running', running: true, activeTurnId: 'turn-1', queue: [{ id: 'queued-1', text: 'Also check the docs', createdAt: 1 }] });
        await until(() => button('Send now') !== null);
        await clickOn(button('Send now'));
        await until(() => machine.requests('chat.sendNow').length === 1);
        expect(machine.requests('chat.sendNow')[0]).toMatchObject({ chatId: first, messageId: 'queued-1' });
    });

    test('Stop ends the running turn on the machine', async () => {
        tell(first, { status: 'running', running: true, activeTurnId: 'turn-1' });
        await clickOn(button('Stop. Shift-click stops sub-agents too'));
        await until(() => machine.requests('chat.cancel').length === 1);
        expect(machine.requests('chat.cancel')[0]).toEqual({ chatId: first });
    });

    test('a draft stays in its chat while another view is on screen, and goes nowhere', async () => {
        await type(first, 'Half a thought');
        await showView(second);
        expect(text(second)).toBe('');
        await showView(first);
        expect(text(first)).toBe('Half a thought');
        expect(machine.requests('chat.send')).toEqual([]);
    });
});

/* Puts a chat of the project on the draft the way a person does, from the `@` picker. */
async function attachChat(viewId: string, title: string): Promise<void> {
    await type(viewId, '@');
    await until(() => option(viewId, title) !== null);
    await clickOn(option(viewId, title));
}

function option(viewId: string, title: string): Element | null {
    const options = page.host.querySelectorAll(`[data-split-cell][data-view-id="${viewId}"] [role="option"]`);
    return Array.from(options).find((candidate) => candidate.textContent?.trim() === title) ?? null;
}

/* The chats on the draft, by the remove button each chip carries. */
function chipOf(title: string): Element | null {
    return button(`Remove ${title}`);
}

async function toggleStash(viewId: string): Promise<void> {
    const apple = isApplePlatform();
    await pressKey(composer(viewId)!.contentDOM, 's', { metaKey: apple, ctrlKey: !apple });
}

function notice(viewId: string): string | null {
    return page.host.querySelector(`[data-split-cell][data-view-id="${viewId}"] [role="status"]`)?.textContent ?? null;
}

describe('a stashed prompt', () => {
    test('keeps the chats attached to it and gives them back in another chat of the project', async () => {
        await attachChat(first, 'Third');
        await type(first, 'Compare these');
        await toggleStash(first);
        await until(() => chipOf('Third') === null);
        await showView(second);
        await toggleStash(second);
        await until(() => chipOf('Third') !== null);
        expect(text(second)).toBe('Compare these');
        expect(notice(second)).toBeNull();
        await pressKey(composer(second)!.contentDOM, 'Enter');
        await until(() => machine.requests('chat.send').length === 1);
        expect(machine.requests('chat.send')[0]).toMatchObject({ chatId: second, text: 'Compare these', chats: [third] });
    });

    test('leaves out the chats another project does not have and says so', async () => {
        await attachChat(first, 'Second');
        await attachChat(first, 'Third');
        await type(first, 'Compare these');
        await toggleStash(first);
        await until(() => chipOf('Second') === null);

        await page.unmount();
        workspace.close();
        const other = [
            { kind: 'chat', id: first, name: 'First', node: { provider: 'claude' } },
            { kind: 'chat', id: third, name: 'Third', node: { provider: 'claude' } }
        ];
        workspace = await openFakeWorkspace(
            machine,
            { views: other } as never,
            { activeViewId: first, views: {} },
            { projectId: 'project-other', name: 'Other' }
        );
        page = mount();
        await page.renderApp();
        await until(() => composer(first) !== null);

        await toggleStash(first);
        await until(() => text(first) !== '');
        expect(chipOf('Third')).not.toBeNull();
        expect(chipOf('Second')).toBeNull();
        expect(notice(first)).toBe('Left out 1 chat from another project');
        await pressKey(composer(first)!.contentDOM, 'Enter');
        await until(() => machine.requests('chat.send').length === 1);
        expect(machine.requests('chat.send')[0]).toMatchObject({ chatId: first, chats: [third] });
    });
});

const STOPPED_TURN = { kind: 'turn', id: 'turn-1', turnId: 'turn-1', createdAt: 1, endedAt: 2, state: 'aborted', costUsd: 0 };

/* What the machine's stream says about a turn that ended, and then about the chat. */
function settle(chatId: string, items: object[], patch: Partial<ChatInfo> = {}): void {
    for (const item of items) {
        seq += 1;
        act(() => machine.emit('chat.event', { chatId, event: { type: 'item', item } as never, seq }));
    }
    tell(chatId, patch);
}

function continueButton(viewId: string): Element | null {
    const buttons = page.host.querySelectorAll(`[data-split-cell][data-view-id="${viewId}"] button`);
    return Array.from(buttons).find((candidate) => candidate.textContent?.trim() === 'Continue') ?? null;
}

describe('Continue after a stop', () => {
    test('stands in the empty box once a person stopped the turn, and one click sends it once', async () => {
        settle(first, [STOPPED_TURN]);
        await until(() => continueButton(first) !== null);
        expect(button('Send')).toBeNull();
        await clickOn(continueButton(first));
        await until(() => machine.requests('chat.send').length === 1);
        const sent = machine.requests('chat.send')[0]!;
        expect(sent).toMatchObject({ chatId: first, text: 'Continue.' });
        expect(sent.delivery).toBeUndefined();
        expect(sent.chats).toBeUndefined();
        // The chat takes a moment to answer, and Continue must not stand there meanwhile.
        expect(continueButton(first)).toBeNull();
        expect(machine.requests('chat.send')).toHaveLength(1);
    });

    test('gives way to the send button while something is typed', async () => {
        settle(first, [STOPPED_TURN]);
        await until(() => continueButton(first) !== null);
        await type(first, 'Try the other way');
        await until(() => continueButton(first) === null);
        expect(button('Send')).not.toBeNull();
    });

    const NOT_A_PERSONS_STOP: Array<[string, object[], Partial<ChatInfo>]> = [
        ['a usage limit', [{ ...STOPPED_TURN, state: 'error', limit: { kind: 'usage' } }], { limit: { kind: 'usage' } }],
        ['a paused queue', [STOPPED_TURN], { queue: [{ id: 'queued-1', text: 'Also check the docs', createdAt: 3 }] }],
        [
            'a restart the machine could not resume from',
            [
                STOPPED_TURN,
                {
                    kind: 'note',
                    id: 'note-1',
                    turnId: 'turn-1',
                    createdAt: 2,
                    level: 'warning',
                    text: 'This turn could not be resumed after the machine restarted: it was a long one'
                }
            ],
            {}
        ],
        [
            'a chat that ended with its parent',
            [STOPPED_TURN, { kind: 'note', id: 'ended-1', turnId: 'turn-1', createdAt: 2, level: 'info', text: 'Ended with its parent' }],
            {}
        ],
        ['a request that waits on a person', [STOPPED_TURN], { status: 'needs-you' }]
    ];

    test.each(NOT_A_PERSONS_STOP)('is not offered after %s', async (_name, items, patch) => {
        settle(first, items, patch);
        // The send button returns only once the chat row has taken the stopped turn, so Continue's absence is read after it.
        await until(() => button('Send') !== null);
        expect(continueButton(first)).toBeNull();
    });
});
