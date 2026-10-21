import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { readChatPreferences, rememberChatPreferences } from '@adecore/agents-react/chat';
import type { ProjectView, RuntimeMode } from '@ruimte/contracts';
import { openNewChatAfterSend } from '@/chat/new-chat-after-send';
import { currentEndpointId } from '@/state/keys';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../testing/dom';

const LEAD: ProjectView = { kind: 'chat', id: 'chat-lead', name: 'Lead', node: {} };

const previousMode = readChatPreferences().runtimeMode;

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

/* The mode each chat runs in on the machine, as it was created and configured. */
const modes = new Map<string, RuntimeMode>();

afterEach(async () => {
    rememberChatPreferences({ runtimeMode: previousMode });
    await page.unmount();
    workspace.close();
    modes.clear();
});

describe('a new chat opened from a chat with Mod+Alt+Enter', () => {
    test("runs in that chat's mode as its own and leaves the default alone", async () => {
        rememberChatPreferences({ runtimeMode: 'supervised' });
        modes.set(LEAD.id, 'auto-accept-edits');
        machine = new FakeMachine();
        machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
        machine.answer('chat.create', ({ chatId, runtimeMode }) => {
            if (!modes.has(chatId) && runtimeMode !== undefined) {
                modes.set(chatId, runtimeMode);
            }
            return {} as never;
        });
        machine.answer(
            'chat.attach',
            ({ chatId }) => ({ info: chatInfoOf(chatId, { runtimeMode: modes.get(chatId) ?? 'supervised' }), items: [], seq: 0 }) as never
        );
        machine.answer('chat.configure', ({ chatId, runtimeMode }) => {
            if (runtimeMode !== undefined) {
                modes.set(chatId, runtimeMode);
            }
            return chatInfoOf(chatId, { runtimeMode: modes.get(chatId) ?? 'supervised' }) as never;
        });
        workspace = await openFakeWorkspace(machine, { views: [LEAD] }, { activeViewId: LEAD.id, views: {} });
        page = mount();
        await page.renderApp();
        await until(() => machine.requests('chat.attach').some((request) => request.chatId === LEAD.id));

        await act(async () => openNewChatAfterSend(currentEndpointId(), LEAD.id));
        const made = (): string | undefined => machine.requests('chat.create').find((request) => request.chatId !== LEAD.id)?.chatId;
        await until(() => made() !== undefined && modes.get(made()!) === 'auto-accept-edits');

        expect(modes.get(made()!)).toBe('auto-accept-edits');
        expect(readChatPreferences().runtimeMode).toBe('supervised');
    });
});
