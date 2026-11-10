import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useProvidersStore } from '@adecore/agents-react/state';
import { REQUEST_SCHEMAS, type ProjectView, type RequestType } from '@ruimte/contracts';
import { act } from 'react';
import { layOutChat, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { fakeProvider } from '../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { idleChatInfo } from '../../testing/project-fixtures';

const LEAD: ProjectView = { kind: 'chat', id: 'chat-lead', name: 'Lexer', node: { provider: 'claude' } };
const BEFORE_FORK_CAPABILITY = (Object.keys(REQUEST_SCHEMAS) as RequestType[]).filter((type) => type !== 'project.watch');

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let restoreLayout: () => void;

function forkButton(): Element | null {
    return document.querySelector('[aria-label="Fork from here"]');
}

async function open(): Promise<void> {
    workspace = await openFakeWorkspace(machine, { views: [LEAD] } as never, { activeViewId: LEAD.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => page.host.textContent?.includes('Written.') === true && Object.values(useProvidersStore.getState().byScope).some((row) => row.loaded));
}

beforeEach(() => {
    restoreLayout = layOutChat();
    machine = new FakeMachine();
    // Claude Code as a machine from before the `fork` capability lists it: without a word about forking.
    machine.answer('provider.list', () => ({ providers: [fakeProvider('claude', 'Claude Code')] }));
    machine.answer(
        'chat.attach',
        () =>
            ({
                info: idleChatInfo(LEAD.id),
                items: [
                    { id: 'turn-1', kind: 'turn', createdAt: 1, turnId: 'turn-1', state: 'done', endedAt: 2, costUsd: 0 },
                    { id: 'user-1', kind: 'user', createdAt: 1, turnId: 'turn-1', text: 'Write the lexer' },
                    { id: 'reply-1', kind: 'assistant', createdAt: 2, turnId: 'turn-1', text: 'Written.', streaming: false }
                ],
                seq: 1
            }) as never
    );
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    restoreLayout();
});

describe('Fork against a machine from before the fork capability', () => {
    test('a person sees Fork on a Claude Code chat, as the machine offered it before', async () => {
        machine.answersOnly(BEFORE_FORK_CAPABILITY);
        await open();
        await until(() => forkButton() !== null);
    });

    test('a machine that turns out older after its list came offers Fork once it says so', async () => {
        await open();

        expect(forkButton()).toBeNull();

        await act(async () => machine.answersOnly(BEFORE_FORK_CAPABILITY));
        await until(() => forkButton() !== null);
    });
});
