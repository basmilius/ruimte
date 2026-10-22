import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { REQUEST_SCHEMAS, type ChatInfo, type ProjectView, type RequestType } from '@ruimte/contracts';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { useChats } from '@adecore/agents-react/state';
import { useProposals } from '@/state/proposals';
import { useUi } from '@/state/ui';
import { clickOn, mount, openSubmenu, until, type Mounted } from '../../testing/dom';

const WRITTEN: ProjectView = { kind: 'chat', id: 'written', name: 'Vinyl notes', node: {} };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

async function open(summary: { scratch?: boolean }, features?: RequestType[]): Promise<void> {
    machine = new FakeMachine();
    if (features !== undefined) {
        machine.answersOnly(features);
    }
    workspace = await openFakeWorkspace(machine, { views: [WRITTEN] }, { activeViewId: WRITTEN.id, views: {} }, summary);
    page = mount();
    await page.renderApp();
}

function menuLabels(): string[] {
    return ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).map((item) => item.textContent ?? '');
}

/* The fake machine answers every chat as running; a test that needs it quiet says so. */
async function setChatStatus(status: 'idle' | 'running' | 'needs-you', patch: Partial<ChatInfo> = {}): Promise<void> {
    await act(async () => {
        useChats.setState((state) => ({
            byKey: Object.fromEntries(Object.entries(state.byKey).map(([key, row]) => [key, { ...row, info: { ...row.info, status, ...patch } }]))
        }));
    });
}

/* The one row both ways out of Chats sit behind. */
function moveRow(): HTMLElement | undefined {
    return ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.includes('Move to project'));
}

function makeProjectRow(): HTMLElement | undefined {
    return ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.includes('Make project'));
}

async function openViewMenu(viewId: string): Promise<void> {
    await until(() => page.host.querySelector(`[data-sidebar-row="view:${viewId}"]`) !== null);
    const row = page.host.querySelector(`[data-sidebar-row="view:${viewId}"]`)!;
    await act(async () => {
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40, button: 2 }));
    });
    await until(() => menuLabels().length > 0);
}

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('moving a chat out of Chats, from its view menu', () => {
    test('a chat someone wrote in offers a project and a move', async () => {
        await open({ scratch: true });
        await setChatStatus('idle');
        await openViewMenu(WRITTEN.id);
        await openSubmenu('Move to project');
        expect(menuLabels()).toEqual(expect.arrayContaining([expect.stringContaining('Make project…'), expect.stringContaining('Other project…')]));
    });

    test('"Make project…" asks for the dialog on this chat with no project picked', async () => {
        await open({ scratch: true });
        await setChatStatus('idle');
        await openViewMenu(WRITTEN.id);
        await openSubmenu('Move to project');
        await clickOn(makeProjectRow() ?? null);
        expect(useUi.getState().moveChatDialog).toEqual({ chatId: WRITTEN.id, mode: 'make', projectId: null });
        useUi.getState().setMoveChatDialog(null);
    });

    test('the row is off while the chat works', async () => {
        await open({ scratch: true });
        await setChatStatus('needs-you');
        await openViewMenu(WRITTEN.id);
        expect(moveRow()?.getAttribute('aria-disabled')).toBe('true');
        await clickOn(moveRow() ?? null);
        expect(useUi.getState().moveChatDialog).toBeNull();
    });

    test('the row stays on while the only thing the chat waits for is the card of its own suggestion', async () => {
        await open({ scratch: true });
        await act(async () =>
            useProposals
                .getState()
                .setProposals('fake-machine', [{ proposalId: 'proposal-1', chatId: WRITTEN.id, name: 'Vinyl', reason: 'It grew', createdAt: 1, expiresAt: 2 }])
        );
        await setChatStatus('needs-you', { activeTurnId: null });
        await openViewMenu(WRITTEN.id);
        expect(moveRow()?.getAttribute('aria-disabled')).not.toBe('true');
        await act(async () => useProposals.getState().forget('fake-machine'));
    });

    describe('in the command palette', () => {
        const paletteLabels = (): string[] => ([...document.querySelectorAll('[role="option"]')] as HTMLElement[]).map((row) => row.textContent ?? '');

        async function openPalette(): Promise<void> {
            await act(async () => useUi.getState().setPaletteOpen(true));
            await until(() => paletteLabels().length > 2);
            await act(async () => {
                const field = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'project');
                field.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }

        afterEach(async () => {
            await act(async () => useUi.getState().setPaletteOpen(false));
        });

        test('both rows are there for a quiet chat in Chats', async () => {
            await open({ scratch: true });
            await setChatStatus('idle');
            await openPalette();
            expect(paletteLabels()).toEqual(
                expect.arrayContaining([expect.stringContaining('Make project from chat'), expect.stringContaining('Move chat to project')])
            );
        });

        test('and for a chat that only waits for the card of its own suggestion', async () => {
            await open({ scratch: true });
            await act(async () =>
                useProposals
                    .getState()
                    .setProposals('fake-machine', [
                        { proposalId: 'proposal-1', chatId: WRITTEN.id, name: 'Vinyl', reason: 'It grew', createdAt: 1, expiresAt: 2 }
                    ])
            );
            await setChatStatus('needs-you', { activeTurnId: null });
            await openPalette();
            expect(paletteLabels().some((label) => label.includes('Make project'))).toBe(true);
            await act(async () => useProposals.getState().forget('fake-machine'));
        });

        test('neither is offered while the chat works, since the palette cannot grey a row', async () => {
            await open({ scratch: true });
            await setChatStatus('running');
            await openPalette();
            expect(paletteLabels().some((label) => label.includes('Make project'))).toBe(false);
        });
    });

    test.each([
        ['a subagent in the background', { delegating: true }],
        ['a goal', { goal: { status: 'active' } }],
        ['a message in the queue', { queue: [{ id: 'q1' }] }]
    ] as const)('both rows are off while the chat is idle but has %s', async (_name, patch) => {
        await open({ scratch: true });
        await setChatStatus('idle', patch as unknown as Partial<ChatInfo>);
        await openViewMenu(WRITTEN.id);
        expect(moveRow()?.getAttribute('aria-disabled')).toBe('true');
    });

    test('a chat in a project offers neither', async () => {
        await open({});
        await openViewMenu(WRITTEN.id);
        expect(menuLabels().some((label) => label.includes('Make project'))).toBe(false);
    });

    test('a machine that does not answer chat.move offers neither', async () => {
        await open(
            { scratch: true },
            (Object.keys(REQUEST_SCHEMAS) as RequestType[]).filter((type) => type !== 'chat.move')
        );
        await openViewMenu(WRITTEN.id);
        expect(menuLabels().some((label) => label.includes('Make project'))).toBe(false);
    });
});
