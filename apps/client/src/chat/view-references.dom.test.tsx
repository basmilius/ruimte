import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { EditorView } from '@codemirror/view';
import type { EndpointInfo, ProjectView } from '@ruimte/contracts';
import { useServers } from '@/state/server';
import { startServerInfo } from '@/transport/server-info';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, layOutChat, mount, pressKey, until, type Mounted } from '../../testing/dom';
import { claudeProvider } from '../../testing/fake-provider';

const MACHINE = 'fake-machine';

// Named apart from the other chat tests, so no draft of theirs is in this composer.
const LEAD: ProjectView = { kind: 'chat', id: 'chat-refs-lead', name: 'Lead', node: { provider: 'claude' } };
const PLANNER: ProjectView = { kind: 'chat', id: 'chat-refs-planner', name: 'Planner', node: { provider: 'claude' } };
const SKETCH: ProjectView = { kind: 'drawing', id: 'drawing-schets', name: 'Schets', icon: { kind: 'lucide', value: 'brain' } };

const CLAUDE = claudeProvider({ chat: true, terminal: true, hooks: true, attachments: true, mentions: true, slashCommands: true });

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let stopInfo: () => void;

afterEach(async () => {
    stopInfo();
    await page.unmount();
    workspace.close();
});

/* A machine that says whether it resolves references, with the lead chat in front. */
async function open(viewReferences: boolean, items: object[] = []): Promise<void> {
    machine = new FakeMachine();
    const info: EndpointInfo = {
        id: MACHINE,
        label: 'Fake machine',
        platform: 'darwin',
        version: '1',
        reachability: 'lan',
        authenticated: true,
        viewReferences
    };
    machine.answer('endpoint.info', () => info);
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: chatId === LEAD.id ? items : [], seq: items.length }) as never);
    machine.answer('chat.send', () => ({ queued: false, turnId: 'turn-1' }));
    workspace = await openFakeWorkspace(machine, { views: [LEAD, PLANNER, SKETCH] } as never, { activeViewId: LEAD.id, views: {} });
    stopInfo = startServerInfo();
    page = mount();
    await page.renderApp();
    await until(() => composer() !== null && useServers.getState().byEndpoint[MACHINE] !== undefined);
}

function composer(): EditorView | null {
    const content = page.host.querySelector(`[data-split-cell][data-view-id="${LEAD.id}"] .cm-content`);
    return content === null ? null : EditorView.findFromDOM(content as HTMLElement);
}

async function type(words: string): Promise<void> {
    await act(async () => {
        const view = composer()!;
        view.dispatch(view.state.replaceSelection(words), { userEvent: 'input.type' });
    });
}

function options(): Element[] {
    return [...page.host.querySelectorAll('[role="option"]')];
}

function option(name: string): Element | null {
    return options().find((candidate) => candidate.textContent?.startsWith(name)) ?? null;
}

describe('a # in the composer', () => {
    test('offers the drawing under the icon picked for it, puts it in the text as a chip and sends its id', async () => {
        await open(true);
        await type('Draw a sun in #Sch');
        await until(() => option('Schets') !== null);
        expect(option('Schets')?.textContent).toBe('Schetsdrawing');
        expect(option('Schets')?.querySelector('svg.lucide-brain')).not.toBeNull();
        await clickOn(option('Schets'));
        expect(composer()!.state.doc.toString()).toBe('Draw a sun in #Schets ');
        const chip = [...page.host.querySelectorAll('.cm-content span')].find((span) => span.className.includes('bg-text/8'));
        expect(chip?.textContent).toBe('Schets');
        await until(() => chip?.querySelector('svg.lucide-brain') != null);
        await pressKey(composer()!.contentDOM, 'Enter');
        await until(() => machine.requests('chat.send').length === 1);
        expect(machine.requests('chat.send')[0]).toMatchObject({ chatId: LEAD.id, text: 'Draw a sun in #Schets', references: [SKETCH.id], chats: [] });
    });

    test('on a machine from before references offers chats only, and sends them as chats', async () => {
        await open(false);
        await type('#Sch');
        expect(options()).toEqual([]);
        await act(async () => composer()!.dispatch({ changes: { from: 0, to: composer()!.state.doc.length } }));
        await type('Ask #Pla');
        await until(() => option('Planner') !== null);
        await clickOn(option('Planner'));
        await pressKey(composer()!.contentDOM, 'Enter');
        await until(() => machine.requests('chat.send').length === 1);
        const sent = machine.requests('chat.send')[0]!;
        expect(sent).toMatchObject({ text: 'Ask #Planner', chats: [PLANNER.id] });
        expect(sent.references).toBeUndefined();
    });
});

/* What a copy writes and a paste reads, by type, the way the browser's clipboard does. */
function clipboardOf() {
    const data: Record<string, string> = {};
    return {
        data,
        files: [] as File[],
        get types() {
            return Object.keys(data);
        },
        getData: (type: string) => data[type] ?? '',
        setData: (type: string, value: string) => {
            data[type] = value;
        }
    };
}

describe('a # after the message went out', () => {
    let restoreLayout: () => void;

    beforeEach(() => {
        restoreLayout = layOutChat();
    });

    afterEach(() => {
        restoreLayout();
    });

    test('a reply that names the drawing draws it as a chip, and a copied message pastes back with its chips', async () => {
        const asked = { id: 'asked', kind: 'user', turnId: 'turn-0', createdAt: 1, text: 'Look at #Schets', references: [SKETCH.id] };
        const answered = { id: 'answered', kind: 'assistant', turnId: 'turn-0', createdAt: 2, text: 'I drew in #Schets.', streaming: false };
        await open(true, [asked, answered]);
        const cell = (): Element => page.host.querySelector(`[data-split-cell][data-view-id="${LEAD.id}"]`)!;
        await until(() => cell().querySelectorAll('[data-chip="reference"]').length === 2);
        expect([...cell().querySelectorAll('[data-chip="reference"]')].map((chip) => chip.getAttribute('data-chip-value'))).toEqual([SKETCH.id, SKETCH.id]);
        expect(cell().querySelectorAll('[data-chip="reference"] svg.lucide-brain')).toHaveLength(2);

        // The copy goes through a copy event, which happy-dom does not fire for the command itself.
        const clipboard = clipboardOf();
        const original = document.execCommand;
        document.execCommand = () => {
            document.dispatchEvent(Object.assign(new Event('copy', { bubbles: true, cancelable: true }), { clipboardData: clipboard }));
            return true;
        };
        try {
            const message = cell().querySelector('[data-find-item="asked"]')!.closest('.group\\/message')!;
            await clickOn(message.querySelector('[aria-label="Copy message"]'));
        } finally {
            document.execCommand = original;
        }
        expect(clipboard.data['text/plain']).toBe('Look at #Schets');
        expect(JSON.parse(clipboard.data['application/x-adecore-chips']!)).toEqual({
            text: 'Look at #Schets',
            mentions: [],
            skills: [],
            references: [{ id: SKETCH.id, name: 'Schets' }]
        });

        // A selection of the reply copies its chip the same way, the hidden sigil with the name.
        const selected = clipboardOf();
        const words = cell().querySelector('[data-find-item="answered"] p')!;
        await act(async () => {
            document.getSelection()!.selectAllChildren(words);
            words.dispatchEvent(Object.assign(new Event('copy', { bubbles: true, cancelable: true }), { clipboardData: selected }));
        });
        expect(JSON.parse(selected.data['application/x-adecore-chips'] ?? 'null')).toMatchObject({ references: [{ id: SKETCH.id, name: 'Schets' }] });

        await act(async () => {
            const event = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), { clipboardData: clipboard });
            composer()!.contentDOM.dispatchEvent(event);
        });
        expect(composer()!.state.doc.toString()).toBe('Look at #Schets');
        await pressKey(composer()!.contentDOM, 'Enter');
        await until(() => machine.requests('chat.send').length === 1);
        expect(machine.requests('chat.send')[0]).toMatchObject({ text: 'Look at #Schets', references: [SKETCH.id] });
    });

    test('Copy message in the thread menu carries the chips too, and a paste sends them again', async () => {
        const answered = { id: 'answered', kind: 'assistant', turnId: 'turn-0', createdAt: 2, text: 'I drew in #Schets.', streaming: false };
        await open(true, [answered]);
        const cell = (): Element => page.host.querySelector(`[data-split-cell][data-view-id="${LEAD.id}"]`)!;
        await until(() => cell().querySelectorAll('[data-chip="reference"]').length === 1);

        const words = cell().querySelector('[data-find-item="answered"] p')!;
        await act(async () => {
            words.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40, button: 2 }));
        });
        const item = (): HTMLElement | undefined =>
            ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((candidate) => candidate.textContent?.includes('Copy message'));
        await until(() => item() !== undefined);

        const clipboard = clipboardOf();
        const original = document.execCommand;
        document.execCommand = () => {
            document.dispatchEvent(Object.assign(new Event('copy', { bubbles: true, cancelable: true }), { clipboardData: clipboard }));
            return true;
        };
        try {
            await clickOn(item() ?? null);
        } finally {
            document.execCommand = original;
        }
        expect(clipboard.data['text/plain']).toBe('I drew in #Schets.');
        expect(JSON.parse(clipboard.data['application/x-adecore-chips'] ?? 'null')).toMatchObject({ references: [{ id: SKETCH.id, name: 'Schets' }] });

        await act(async () => {
            const event = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), { clipboardData: clipboard });
            composer()!.contentDOM.dispatchEvent(event);
        });
        await pressKey(composer()!.contentDOM, 'Enter');
        await until(() => machine.requests('chat.send').length === 1);
        expect(machine.requests('chat.send')[0]).toMatchObject({ text: 'I drew in #Schets.', references: [SKETCH.id] });
    });
});
