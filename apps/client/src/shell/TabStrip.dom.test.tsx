import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectView } from '@ruimte/contracts';
import { useFiles } from '@/state/files';
import { useDocument } from '@/state/document';
import { useViewPins } from '@/state/view-pins';
import { useSnoozes } from '@/state/snooze';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { menuItem } from '../../testing/dom-helpers';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { emptyCanvas } from '../../testing/project-fixtures';

const CHAT: ProjectView = { kind: 'chat', id: 'chat-view', name: 'Notes chat', node: {} };
const SHELL: ProjectView = { kind: 'terminal', id: 'shell-view', name: 'Shell', node: {} };
const DESIGN: ProjectView = {
    kind: 'design',
    id: 'design-view',
    name: 'Onboarding',
    node: {},
    path: 'onboarding',
    chats: [{ id: 'design-review', name: 'Review', node: {} }]
};
const FILE = '/work/atlas/src/a.ts';
const CANVAS = {
    ...emptyCanvas('writers', 'Writers'),
    nodes: ['writer-a', 'writer-b'].map((id) => ({ id, kind: 'chat' as const, title: id, x: 0, y: 0, w: 480, h: 520 }))
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function tab(id: string): HTMLElement | null {
    return page.host.querySelector<HTMLElement>(`[data-tab-id="${id}"]`);
}

function tabIds(): string[] {
    // The strip measures its tabs in copies of its own, so a tab can be in the page more than once.
    return [...new Set([...page.host.querySelectorAll<HTMLElement>('[data-tab-id]')].map((element) => element.dataset.tabId ?? ''))];
}

/* A host left with one view of the project is a plain cell again, without a strip. */
function chatCell(): Element | null {
    return page.host.querySelector(`[data-split-cell][data-view-id="${CHAT.id}"]`);
}

async function openMenuOf(element: HTMLElement | null): Promise<void> {
    expect(element).not.toBeNull();
    await act(async () => {
        element!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40, button: 2 }));
    });
    await until(() => document.querySelector('[role="menu"]') !== null);
}

function selected(id: string): boolean {
    return tab(id)?.querySelector('[role="tab"]')?.getAttribute('aria-selected') === 'true';
}

/* A press and its release on a tab, where a person aims: on its label rather than its close button. */
async function pressTab(id: string, init: MouseEventInit): Promise<void> {
    const label = tab(id)!.querySelector<HTMLElement>('[role="tab"]')!;
    await act(async () => {
        label.dispatchEvent(new MouseEvent('mousedown', { ...init, bubbles: true, cancelable: true }));
        label.dispatchEvent(new MouseEvent(init.button === 1 ? 'auxclick' : 'click', { ...init, bubbles: true, cancelable: true }));
    });
}

const CLOSING_PRESSES: Array<[string, MouseEventInit]> = [
    ['a shift-click', { button: 0, shiftKey: true }],
    ['a middle click', { button: 1 }]
];

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('fs.read', () => ({ kind: 'text', text: 'export {};\n', encoding: 'utf-8', size: 11, mtime: 1, language: 'typescript' }) as never);
    useViewPins.setState({ pins: {} });
    workspace = await openFakeWorkspace(machine, { views: [CHAT, SHELL, CANVAS, DESIGN] } as never, { activeViewId: CHAT.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => chatCell() !== null);
    await act(async () => {
        useDocument.getState().dropViewAsTab(SHELL.id, { column: 0, cell: 0 }, null);
    });
    await until(() => tab(CHAT.id) !== null && tab(SHELL.id) !== null);
    await act(async () => useFiles.getState().open(FILE, 10));
    await until(() => tab(FILE) !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    useViewPins.setState({ pins: {} });
});

describe('the tabs of a host', () => {
    test('a design tab counts both its original chat and a later chat', async () => {
        machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId, { status: 'needs-you' }), items: [] }));

        await act(async () => {
            useDocument.getState().dropViewAsTab(DESIGN.id, { column: 0, cell: 0 }, null);
            useDocument.getState().activateTab(FILE);
            for (const chatId of [DESIGN.id, 'design-review']) {
                machine.emit('chat.status', { chatId, info: chatInfoOf(chatId, { status: 'needs-you' }) });
            }
        });
        await until(() => (tab(DESIGN.id)?.querySelector('[aria-label="2 waiting"]') ?? null) !== null);
        expect(tab(DESIGN.id)!.querySelector('[aria-label="2 waiting"]')!.textContent).toBe('2');
    });

    test('a background canvas counts waiting sessions and follows snoozes and answers', async () => {
        machine.answer('chat.attach', ({ chatId }) => ({
            info: chatInfoOf(chatId, { status: CANVAS.nodes.some((node) => node.id === chatId) ? 'needs-you' : 'idle' }),
            items: []
        }));

        await act(async () => {
            useDocument.getState().dropViewAsTab(CANVAS.id, { column: 0, cell: 0 }, null);
            useDocument.getState().activateTab(FILE);
            for (const node of CANVAS.nodes) {
                machine.emit('chat.status', { chatId: node.id, info: chatInfoOf(node.id, { status: 'needs-you' }) });
            }
        });
        await until(() => (tab(CANVAS.id)?.querySelector('[aria-label="2 waiting"]') ?? null) !== null);
        expect(tab(CANVAS.id)!.querySelector('[aria-label="2 waiting"]')!.textContent).toBe('2');

        await act(async () => useSnoozes.getState().receive('fake-machine', [{ nodeId: 'writer-a', until: 4_000_000_000_000 }]));
        await until(() => (tab(CANVAS.id)?.querySelector('[aria-label="1 waiting"]') ?? null) !== null);
        await act(async () => machine.emit('chat.status', { chatId: 'writer-b', info: chatInfoOf('writer-b', { status: 'idle' }) }));
        await until(() => tab(CANVAS.id)?.querySelector('[aria-label$="waiting"]') === null);
        expect(selected(FILE)).toBe(true);
        await act(async () => useSnoozes.getState().receive('fake-machine', []));
    });

    test('"Close other tabs" on a file takes the chat and the terminal off the screen and leaves them in the project', async () => {
        expect(tabIds()).toEqual([CHAT.id, SHELL.id, FILE]);
        await openMenuOf(tab(FILE));
        await clickOn(menuItem('Close other tabs'));
        await until(() => tabIds().length === 1);
        expect(tabIds()).toEqual([FILE]);
        expect(page.host.querySelector(`[data-sidebar-row="view:${CHAT.id}"]`)).not.toBeNull();
        expect(page.host.querySelector(`[data-sidebar-row="view:${SHELL.id}"]`)).not.toBeNull();
        expect(machine.requests('session.kill')).toEqual([]);
    });

    test('a chat offers the same ways to close tabs as a file', async () => {
        await openMenuOf(tab(CHAT.id));
        expect(menuItem('Pin tab')).not.toBeNull();
        await clickOn(menuItem('Close tabs to the right'));
        await until(() => tab(FILE) === null && tab(SHELL.id) === null);
        expect(chatCell()).not.toBeNull();
        expect(page.host.querySelector(`[data-sidebar-row="view:${SHELL.id}"]`)).not.toBeNull();
    });

    test.each(CLOSING_PRESSES)('%s takes a tab in the back off the screen and leaves the active tab where it is', async (_name, init) => {
        expect(selected(FILE)).toBe(true);
        await pressTab(SHELL.id, init);
        await until(() => tab(SHELL.id) === null);
        expect(selected(FILE)).toBe(true);
        expect(page.host.querySelector(`[data-sidebar-row="view:${SHELL.id}"]`)).not.toBeNull();
        expect(machine.requests('session.kill')).toEqual([]);
    });

    test.each(CLOSING_PRESSES)('%s leaves a pinned tab open', async (_name, init) => {
        await openMenuOf(tab(SHELL.id));
        await clickOn(menuItem('Pin tab'));
        await pressTab(SHELL.id, init);
        await act(async () => undefined);
        expect(tab(SHELL.id)).not.toBeNull();
    });

    test('a shift-click on a tab with edits nobody submitted asks before it closes', async () => {
        await act(async () => useFiles.getState().setUnsubmitted(FILE, true));
        await pressTab(FILE, { button: 0, shiftKey: true });
        await until(() =>
            [...document.querySelectorAll('[role="dialog"]')].some((dialog) => dialog.textContent?.includes('These edits were never submitted.'))
        );
        expect(tab(FILE)).not.toBeNull();
    });

    test('a pinned chat stays when every tab closes', async () => {
        await openMenuOf(tab(CHAT.id));
        await clickOn(menuItem('Pin tab'));
        await openMenuOf(tab(SHELL.id));
        await clickOn(menuItem('Close all tabs'));
        await until(() => tab(FILE) === null && tab(SHELL.id) === null);
        expect(chatCell()).not.toBeNull();
    });
});
