import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ChatMoveInfoResult, ChatMovePayload, ProjectSummary, ProjectView } from '@ruimte/contracts';
import { TransportError } from '@/transport/transport';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import type { DesktopBridge } from '@/desktop/bridge';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const CHAT: ProjectView = { kind: 'chat', id: 'written', name: 'Vinyl notes', node: {} };

const VINYL: ProjectSummary = {
    projectId: 'project-vinyl',
    name: 'vinyl-shelf',
    color: '#000',
    folder: '/work/vinyl-shelf',
    lastOpenedAt: 0,
    closedAt: null,
    available: true,
    icon: { kind: 'initial', value: 'V' },
    nameSource: 'chosen'
};

const INFO: ChatMoveInfoResult = {
    folders: [
        { path: '/work/vinyl-shelf', project: null, branch: 'main', files: 7 },
        { path: '/work/atlas', project: { projectId: 'project-atlas', name: 'Atlas' }, branch: null, files: 2 }
    ],
    ownFiles: { folder: '/home/.ruimte/scratch/written', count: 2, names: ['notes.md', 'sketch.png'] },
    conflicts: [],
    references: 0,
    newFolderParent: '/work',
    refusal: null
};

const scope = globalThis as unknown as { window: { ruimteDesktop?: DesktopBridge } };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

async function open(answer: (payload: { to?: unknown }) => ChatMoveInfoResult = () => INFO): Promise<void> {
    machine = new FakeMachine();
    machine.answer('chat.moveInfo', answer);
    machine.answer('chat.move', (payload) => ({ summary: VINYL, viewId: payload.chatId, ownFilesLeftAt: null }));
    workspace = await openFakeWorkspace(
        machine,
        { views: [CHAT] },
        { activeViewId: CHAT.id, views: {} },
        { scratch: true, projectId: 'project-chats', name: 'Chats' }
    );
    machine.answer('project.open', (payload) =>
        payload.projectId === VINYL.projectId
            ? {
                  summary: VINYL,
                  document: { version: 3, rev: 1, name: VINYL.name, color: '#000', views: [CHAT], shared: [] } as never,
                  local: { activeViewId: null, views: {} } as never
              }
            : {
                  summary: { ...VINYL, projectId: 'project-chats', name: 'Chats', scratch: true },
                  document: { version: 3, rev: 1, name: 'Chats', color: '#000', views: [CHAT], shared: [] } as never,
                  local: { activeViewId: CHAT.id, views: {} } as never
              }
    );
    page = mount();
    await page.renderApp();
}

async function ask(mode: 'make' | 'pick', projectId: string | null = null): Promise<void> {
    await act(async () => useUi.getState().setMoveChatDialog({ chatId: CHAT.id, mode, projectId }));
    await until(() => dialog() !== null);
}

function dialog(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="dialog"]');
}

function buttons(): HTMLButtonElement[] {
    return [...(dialog()?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];
}

/* The labels of the footer, which holds Cancel and the action, or only Close when the chat cannot move. */
function footerButtons(): string[] {
    const labels = buttons().map((entry) => entry.textContent?.trim() ?? '');
    return labels.filter((label) => !['Move into project', 'Leave in Chats'].includes(label));
}

function button(label: string): HTMLButtonElement | undefined {
    return buttons().find((entry) => entry.textContent?.trim() === label);
}

async function type(input: HTMLInputElement, text: string): Promise<void> {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

function nameField(): HTMLInputElement {
    return dialog()!.querySelector<HTMLInputElement>('#move-chat-name')!;
}

async function dismiss(): Promise<void> {
    await act(async () => useUi.getState().setMoveChatDialog(null));
}

beforeEach(() => {
    useUi.getState().setMoveChatDialog(null);
});

afterEach(async () => {
    await dismiss();
    await page.unmount();
    delete scope.window.ruimteDesktop;
    workspace.close();
});

describe('making a project of a chat, or moving it into one', () => {
    test('asks the machine where the chat worked and lists the folders, the files and the way to a new one', async () => {
        await open();
        await ask('make');
        await until(() => dialog()!.textContent!.includes('/work/vinyl-shelf'));
        const text = dialog()!.textContent!;
        expect(text).toContain('Make project');
        expect(text).toContain('Where this chat worked · 7 files');
        expect(text).toContain('Where this chat worked · project Atlas');
        expect(text).toContain('New folder');
        expect(text).toContain('Choose a folder…');
        expect(text).toContain('2 files: notes.md, sketch.png');
        expect(nameField().value).toBe('Vinyl notes');
        expect(machine.requests('chat.moveInfo')[0]).toEqual({ chatId: CHAT.id });
    });

    test('says why a chat cannot move, turns the fields off and keeps the window in Chats', async () => {
        await open(() => ({ ...INFO, refusal: { reason: 'agents' } }));
        await ask('make');
        await until(() => dialog()!.textContent!.includes('A chat with agents cannot move'));
        expect(nameField().disabled).toBe(true);
        expect(footerButtons()).toEqual(['Close']);
        await clickOn(button('Close') ?? null);
        await until(() => dialog() === null);
        expect(machine.requests('chat.move')).toHaveLength(0);
        expect(useProject.getState().current?.name).toBe('Chats');
    });

    test('follows the chat while the dialog is open: a chat that finishes its turn makes the dialog usable again', async () => {
        let working = true;
        await open(() => ({ ...INFO, refusal: working ? { reason: 'working' } : null }));
        await ask('make');
        await until(() => dialog()!.textContent!.includes('This chat is still working'));
        expect(nameField().disabled).toBe(true);
        expect(footerButtons()).toEqual(['Close']);

        working = false;
        await act(async () => machine.emit('chat.status', { chatId: CHAT.id, info: chatInfoOf(CHAT.id) }));
        await until(() => !dialog()!.textContent!.includes('This chat is still working'));
        expect(nameField().disabled).toBe(false);
        expect(footerButtons()).toEqual(['Cancel', 'Make project']);
        expect(button('Make project')?.disabled).toBe(false);
    });

    test('a status of another chat does not ask again', async () => {
        await open();
        await ask('make');
        await until(() => dialog()!.textContent!.includes('/work/vinyl-shelf'));
        const asked = machine.requests('chat.moveInfo').length;
        await act(async () => machine.emit('chat.status', { chatId: 'another', info: chatInfoOf('another') }));
        expect(machine.requests('chat.moveInfo')).toHaveLength(asked);
    });

    test('confirming sends one chat.move and the window shows the project with the chat', async () => {
        await open();
        await ask('make');
        await until(() => dialog()!.textContent!.includes('/work/vinyl-shelf'));
        await type(nameField(), 'Vinyl shelf');
        await until(() => dialog()!.textContent!.includes('/work/vinyl-shelf'));
        await clickOn(button('Make project') ?? null);
        await until(() => useProject.getState().current?.projectId === VINYL.projectId);
        expect(machine.requests('chat.move')).toEqual([
            {
                chatId: CHAT.id,
                to: { folder: '/work/vinyl-shelf', name: 'Vinyl shelf', createFolder: true, initGit: true },
                ownFiles: 'move'
            } satisfies ChatMovePayload
        ]);
        expect(useDocument.getState().activeViewId).toBe(CHAT.id);
        await until(() => dialog() === null);
    });

    test('a folder where the chat worked that is a project moves the chat into it, by id', async () => {
        await open();
        await ask('make');
        await until(() => dialog()!.textContent!.includes('project Atlas'));
        const cards = [...dialog()!.querySelectorAll<HTMLElement>('[role="radio"]')];
        await clickOn(cards.find((card) => card.textContent!.includes('/work/atlas')) ?? null);
        await until(() => dialog()!.textContent!.includes('Move to Atlas'));
        expect(dialog()!.querySelector('#move-chat-name')).toBeNull();
        await clickOn(button('Move') ?? null);
        await until(() => machine.requests('chat.move').length === 1);
        expect(machine.requests('chat.move')[0]).toEqual({ chatId: CHAT.id, to: { projectId: 'project-atlas' }, ownFiles: 'leave' });
    });

    test('a project held by another window comes to the front with the chat, and this window stays in Chats', async () => {
        const heard: Array<[string, string | undefined]> = [];
        scope.window.ruimteDesktop = {
            platform: 'darwin',
            pickFolder: async () => null,
            openExternal: async () => undefined,
            openGuestDevTools: () => undefined,
            isFullscreen: async () => false,
            onFullscreen: () => () => undefined,
            claimWindow: async () => false,
            openWindow: (key: string, viewId?: string) => void heard.push([key, viewId])
        } as unknown as DesktopBridge;
        await open();
        await ask('pick', VINYL.projectId);
        await until(() => machine.requests('chat.moveInfo').length > 0);
        await until(() => button('Move') !== undefined && !button('Move')!.disabled);
        await clickOn(button('Move') ?? null);
        await until(() => heard.length === 1);
        expect(heard[0]![1]).toBe(CHAT.id);
        expect(heard[0]![0]).toContain(VINYL.projectId);
        expect(useProject.getState().current?.name).toBe('Chats');
    });

    test('a name the target already holds leaves the files in Chats and keeps the move open', async () => {
        await open((payload) => (payload.to === undefined ? INFO : { ...INFO, conflicts: ['notes.md'] }));
        await ask('pick', VINYL.projectId);
        await until(() => dialog()!.textContent!.includes('notes.md is already in'));
        const radios = [...dialog()!.querySelectorAll<HTMLElement>('[role="radio"]')].filter((radio) =>
            ['Move into project', 'Leave in Chats'].includes(radio.textContent!.trim())
        );
        const move = radios.find((radio) => radio.textContent!.trim() === 'Move into project')!;
        const leave = radios.find((radio) => radio.textContent!.trim() === 'Leave in Chats')!;
        expect(move.hasAttribute('disabled')).toBe(true);
        expect(leave.getAttribute('aria-checked')).toBe('true');
        expect(button('Move')!.disabled).toBe(false);
    });

    test('shows the line about @ references only when a chat would lose one', async () => {
        await open();
        await ask('make');
        await until(() => dialog()!.textContent!.includes('Files this chat made'));
        expect(dialog()!.textContent).not.toContain('to this one with @');
        await dismiss();
        await until(() => dialog() === null);
        machine.answer('chat.moveInfo', () => ({ ...INFO, references: 2 }));
        await ask('make');
        await until(() => dialog()!.textContent!.includes('2 chats in Chats refer to this one with @'));
    });

    test('a move the machine refuses after confirming asks again and shows its reason', async () => {
        let refused = false;
        await open(() => (refused ? { ...INFO, refusal: { reason: 'messages' } } : INFO));
        machine.answer('chat.move', () => {
            refused = true;
            throw new TransportError('move-refused', 'Messages from other chats are waiting for this chat');
        });
        await ask('pick', VINYL.projectId);
        await until(() => button('Move') !== undefined && !button('Move')!.disabled);
        const before = machine.requests('chat.moveInfo').length;
        await clickOn(button('Move') ?? null);
        await until(() => dialog()!.textContent!.includes('Messages from other chats wait'));
        expect(machine.requests('chat.moveInfo').length).toBeGreaterThan(before);
        expect(footerButtons()).toEqual(['Close']);
        expect(useProject.getState().current?.name).toBe('Chats');
    });

    test("a move refused after confirming that the question no longer finds a reason for shows the machine's sentence", async () => {
        await open();
        machine.answer('chat.move', () => {
            throw new TransportError('move-refused', 'This chat is still working. Stop it or wait for it to finish, then try again');
        });
        await ask('pick', VINYL.projectId);
        await until(() => button('Move') !== undefined && !button('Move')!.disabled);
        await clickOn(button('Move') ?? null);
        await until(() => dialog()!.textContent!.includes('This chat is still working. Stop it or wait'));
        expect(button('Move')).toBeDefined();
    });

    test('a failed question shows its message and leaves the new folder usable', async () => {
        await open(() => {
            throw new TransportError('internal', 'The machine is busy');
        });
        await ask('make');
        await until(() => dialog()!.textContent!.includes('The machine is busy'));
        expect(dialog()!.textContent).not.toContain('Where this chat worked');
        expect(dialog()!.textContent).toContain('New folder');
        expect(nameField().disabled).toBe(false);
    });
});
