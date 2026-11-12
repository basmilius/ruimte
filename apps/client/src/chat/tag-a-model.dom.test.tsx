import { afterEach, describe, expect, test } from 'bun:test';
import { useProviderAccountsStore } from '@adecore/agents-react/state';
import { EditorView } from '@codemirror/view';
import type { EndpointInfo, EventMap, ProjectDocument, ProjectView } from '@ruimte/contracts';
import { act } from 'react';
import { useServers } from '@/state/server';
import { startServerInfo } from '@/workspace/server-info';
import { chatInfoOf } from '../../testing/chat-info';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { claudeProvider } from '../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const MACHINE = 'fake-machine';

// Named apart from the other chat tests and from each other, so no draft of theirs is in this composer.
let lead: ProjectView;

const CLAUDE = {
    ...claudeProvider({ chat: true, terminal: true, hooks: true, attachments: true, mentions: true, slashCommands: true }),
    models: [
        { slug: 'claude-sonnet-5-5', name: 'Sonnet 5.5', legacy: false, isDefault: true, options: [] },
        { slug: 'claude-opus-5-5', name: 'Opus 5.5', legacy: false, isDefault: false, options: [] }
    ]
};

type Accounts = EventMap['accounts.changed'];

// Claude Code's own login and a second account beside it, both signed in, so the CLI offers a choice.
const TWO_ACCOUNTS: Accounts = {
    accounts: {
        claude: { kind: 'claude', label: 'Personal' },
        claude_work: { kind: 'claude', label: 'Work', home: '~/.claude-work' }
    },
    statuses: ['claude', 'claude_work'].map((id) => ({
        id,
        kind: 'claude',
        state: 'ready' as const,
        email: null,
        plan: null,
        organization: null,
        home: '',
        message: null,
        checkedAt: 1
    }))
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let stopInfo: () => void;

afterEach(async () => {
    stopInfo();
    await page.unmount();
    workspace.close();
});

async function open(id: string, project: Pick<ProjectDocument, 'accounts'> = {}, accounts?: Accounts): Promise<void> {
    lead = { kind: 'chat', id, name: 'Lead', node: { provider: 'claude' } };
    machine = new FakeMachine();
    const info: EndpointInfo = { id: MACHINE, label: 'Fake machine', platform: 'darwin', version: '1', reachability: 'lan', authenticated: true };
    machine.answer('endpoint.info', () => info);
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }) as never);
    machine.answer('fs.search', () => ({ files: ['src/options.ts'], truncated: false }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
    machine.answer('chat.send', () => ({ queued: false, turnId: 'turn-1' }));

    if (accounts !== undefined) {
        machine.answer('accounts.list', () => accounts);
    }

    workspace = await openFakeWorkspace(machine, { ...project, views: [lead] } as never, { activeViewId: lead.id, views: {} });
    stopInfo = startServerInfo();
    page = mount();
    await page.renderApp();
    await until(() => composer() !== null && useServers.getState().byEndpoint[MACHINE] !== undefined);
}

function composer(): EditorView | null {
    const content = page.host.querySelector(`[data-split-cell][data-view-id="${lead.id}"] .cm-content`);
    return content === null ? null : EditorView.findFromDOM(content as HTMLElement);
}

async function type(words: string): Promise<void> {
    await act(async () => {
        const view = composer()!;
        view.dispatch(view.state.replaceSelection(words), { userEvent: 'input.type' });
    });
}

function labels(): string[] {
    return [...page.host.querySelectorAll('[role="listbox"] [role="group"]')].map((group) => group.firstElementChild?.textContent ?? '');
}

function option(name: string): Element | null {
    return [...page.host.querySelectorAll('[role="option"]')].find((candidate) => candidate.textContent?.includes(name)) ?? null;
}

describe('an @ in the composer', () => {
    test('offers no models on a bare @', async () => {
        await open('chat-tag-bare');
        await type('@');
        await until(() => option('options.ts') !== null);
        expect(option('Opus 5.5')).toBeNull();
    });

    test('offers Models above Files once the query opens a model name, and Enter sends its token as text', async () => {
        await open('chat-tag-model');
        await type('Ask an agent on @op');
        await until(() => option('Opus 5.5') !== null && option('options.ts') !== null);
        expect(labels()).toEqual(['Models', 'Files']);
        await pressKey(composer()!.contentDOM, 'Enter');
        expect(composer()!.state.doc.toString()).toBe('Ask an agent on @model:claude/claude-opus-5-5 ');
        await pressKey(composer()!.contentDOM, 'Enter');
        await until(() => machine.requests('chat.send').length === 1);
        const sent = machine.requests('chat.send')[0]!;
        expect(sent.text).toBe('Ask an agent on @model:claude/claude-opus-5-5');
        expect(sent.mentions ?? []).toEqual([]);
    });

    test('offers Accounts above Files by the name a person gave the account, and Enter sends its token as text', async () => {
        await open('chat-tag-account', {}, TWO_ACCOUNTS);
        await type('Start one on @wo');
        await until(() => option('Work') !== null && option('options.ts') !== null);
        expect(labels()).toEqual(['Accounts', 'Files']);
        await pressKey(composer()!.contentDOM, 'Enter');
        expect(composer()!.state.doc.toString()).toBe('Start one on @account:claude/claude_work ');
        await pressKey(composer()!.contentDOM, 'Enter');
        await until(() => machine.requests('chat.send').length === 1);
        expect(machine.requests('chat.send')[0]!.text).toBe('Start one on @account:claude/claude_work');
    });

    test('leaves out an account the project turned off', async () => {
        await open('chat-tag-account-off', { accounts: { claude: { off: ['claude_work'] } } }, TWO_ACCOUNTS);
        await until(() => useProviderAccountsStore.getState().byScope[MACHINE]?.accounts?.accounts.claude_work !== undefined);
        await type('@wo');
        await until(() => option('options.ts') !== null);
        expect(option('Work')).toBeNull();
        expect(labels()).not.toContain('Accounts');
    });
});
