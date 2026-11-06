import { afterEach, describe, expect, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';
import { act } from 'react';
import { chatInfoOf } from '../../testing/chat-info';
import { mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

/* A chat New Chat made, which names no CLI: the one it runs on is picked in its composer. */
const CHAT: ProjectView = { kind: 'chat', id: 'chat-grok', name: 'Moon phases', node: {} };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function markIn(selector: string): string | null {
    return page.host.querySelector(`${selector} svg[role="img"]`)?.getAttribute('aria-label') ?? null;
}

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('the mark of a chat outside any project', () => {
    test('is the mark of the CLI it runs on, in the sidebar and the bar over its cell', async () => {
        machine = new FakeMachine();
        workspace = await openFakeWorkspace(
            machine,
            { views: [CHAT] },
            { activeViewId: CHAT.id, views: {} },
            { scratch: true, projectId: 'project-chats', name: 'Chats' }
        );
        page = mount();
        await page.renderApp();
        await act(async () => machine.emit('chat.status', { chatId: CHAT.id, info: chatInfoOf(CHAT.id, { provider: 'grok' }) }));
        await until(() => markIn(`[data-sidebar-row="view:${CHAT.id}"]`) !== null && markIn('[data-pane-title]') !== null);

        expect(markIn(`[data-sidebar-row="view:${CHAT.id}"]`)).toBe('Grok');
        expect(markIn('[data-pane-title]')).toBe('Grok');
    });
});
