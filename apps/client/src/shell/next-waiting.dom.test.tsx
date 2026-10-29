import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ChatInfo, ProjectView } from '@ruimte/contracts';
import { isApplePlatform } from '@/desktop/bridge';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, pressKey, until, type Mounted } from '../../testing/dom';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();
const NEWER: ProjectView = { kind: 'chat', id: 'chat-newer', name: 'Release notes', node: {} };
const OLDER: ProjectView = { kind: 'chat', id: 'chat-older', name: 'Flaky test', node: {} };
const IDLE: ProjectView = { kind: 'chat', id: 'chat-idle', name: 'Idle chat', node: {} };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function waitingSince(chatId: string, createdAt: number): ChatInfo {
    return chatInfoOf(chatId, { status: 'needs-you', requests: [{ requestId: `request-${chatId}`, itemId: `item-${chatId}`, kind: 'approval', createdAt }] });
}

function cellTitles(): string {
    return [...document.querySelectorAll('[data-cell-title]')].map((title) => title.textContent ?? '').join(' | ');
}

async function pressNextNeedsYou(): Promise<void> {
    const apple = isApplePlatform();
    await pressKey(document.body, 'p', { altKey: true, metaKey: apple, ctrlKey: !apple });
}

beforeEach(async () => {
    localStorage.clear();
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [MAIN, NEWER, OLDER, IDLE] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => cellTitles().includes('Main'));
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('the key that goes to what needs you', () => {
    test('the dock also opens the oldest wait instead of the first session in project order', async () => {
        const infos: Record<string, ChatInfo> = {
            [NEWER.id]: waitingSince(NEWER.id, 2_000),
            [OLDER.id]: waitingSince(OLDER.id, 1_000)
        };
        machine.answer('chat.attach', ({ chatId }) => ({ info: infos[chatId] ?? chatInfoOf(chatId), items: [] }));

        await act(async () => {
            for (const [chatId, info] of Object.entries(infos)) {
                machine.emit('chat.status', { chatId, info });
            }
        });
        await clickOn(page.host.querySelector<HTMLElement>('[aria-label="Next node that needs you, in any view"]'));
        await until(() => cellTitles().includes('Flaky test'));
        expect(cellTitles()).not.toContain('Release notes');
    });

    test('goes to the chat that waited longest, then to the next, and around again', async () => {
        const infos: Record<string, ChatInfo> = {
            [NEWER.id]: waitingSince(NEWER.id, 2_000),
            [OLDER.id]: waitingSince(OLDER.id, 1_000),
            [IDLE.id]: chatInfoOf(IDLE.id)
        };
        // A chat that opens reads its info again, so it still waits once it is on screen.
        machine.answer('chat.attach', ({ chatId }) => ({ info: infos[chatId] ?? chatInfoOf(chatId), items: [] }));
        await act(async () => {
            for (const [chatId, info] of Object.entries(infos)) {
                machine.emit('chat.status', { chatId, info });
            }
        });

        await pressNextNeedsYou();
        await until(() => cellTitles().includes('Flaky test'));
        await pressNextNeedsYou();
        await until(() => cellTitles().includes('Release notes'));
        await pressNextNeedsYou();
        await until(() => cellTitles().includes('Flaky test'));
        expect(cellTitles()).not.toContain('Release notes');
    });

    test('stays where it is while nothing needs you', async () => {
        await act(async () => machine.emit('chat.status', { chatId: IDLE.id, info: chatInfoOf(IDLE.id) }));
        await pressNextNeedsYou();
        expect(cellTitles()).toContain('Main');
        expect(cellTitles()).not.toContain('Idle chat');
    });
});
