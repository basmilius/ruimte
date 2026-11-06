import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ChatInfo, ChatMoveInfoResult, ProjectProposal, ProjectSummary, ProjectView, ProviderInfo } from '@ruimte/contracts';
import { act } from 'react';
import { moveChatDialog } from '@/project/dialogs';
import { useProject } from '@/state/project';
import { useProposals } from '@/state/proposals';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { fakeProvider } from '../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const ENDPOINT_ID = 'fake-machine';

const CHAT: ProjectView = { kind: 'chat', id: 'written', name: 'Vinyl notes', node: { provider: 'claude' } };

const VINYL: ProjectSummary = {
    projectId: 'project-vinyl',
    name: 'Vinyl shelf',
    color: '#000',
    folder: '/work/vinyl-shelf',
    lastOpenedAt: 0,
    closedAt: null,
    available: true,
    icon: { kind: 'initial', value: 'V' },
    nameSource: 'chosen'
};

const INFO: ChatMoveInfoResult = {
    folders: [{ path: '/work/vinyl-shelf', project: null, branch: 'main', files: 7 }],
    ownFiles: { folder: '/home/.ruimte/scratch/written', count: 0, names: [] },
    conflicts: [],
    references: 0,
    newFolderParent: '/work',
    refusal: null
};

const PROPOSAL: ProjectProposal = {
    proposalId: 'proposal-1',
    chatId: CHAT.id,
    name: 'Vinyl shelf',
    folder: '/work/vinyl-shelf',
    reason: 'The notes became a codebase',
    createdAt: 1,
    expiresAt: 2
};

const CLAUDE = fakeProvider('claude', 'Claude Code', {
    version: '2.1.0',
    capabilities: { chat: true, terminal: true, hooks: true, attachments: true, mentions: true, slashCommands: true } as ProviderInfo['capabilities'],
    resumeCommand: 'claude --resume {id}'
});

function infoOf(chatId: string): ChatInfo {
    return {
        chatId,
        provider: 'claude',
        cwd: '/home/.ruimte/scratch/written',
        agentSessionId: null,
        model: null,
        selection: { model: 'model', options: {} },
        runtimeMode: 'supervised',
        status: 'needs-you',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { turns: 0, contextTokens: 0, contextWindow: 200_000, costUsd: 0 },
        background: []
    } as unknown as ChatInfo;
}

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

/* The page holds one card, so its buttons are the page's. */
function card(): HTMLElement | null {
    return page.host.textContent?.includes('This chat suggests a project') ? page.host : null;
}

function dialog(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="dialog"]');
}

function buttonIn(root: ParentNode | null, label: string): HTMLButtonElement | null {
    return ([...(root?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]).find((entry) => entry.textContent?.trim() === label) ?? null;
}

beforeEach(async () => {
    moveChatDialog.set(null);
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: infoOf(chatId), items: [], seq: 0 }) as never);
    machine.answer('chat.moveInfo', () => INFO);
    machine.answer('chat.move', (payload) => ({ summary: VINYL, viewId: payload.chatId, ownFilesLeftAt: null }));
    machine.answer('chat.proposalDecline', () => ({ accepted: true }));
    workspace = await openFakeWorkspace(
        machine,
        { views: [CHAT] } as never,
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
    await act(async () => useProposals.getState().setProposals(ENDPOINT_ID, [PROPOSAL]));
    await until(() => card() !== null);
});

afterEach(async () => {
    await act(async () => {
        moveChatDialog.set(null);
        useProposals.getState().forget(ENDPOINT_ID);
    });
    await page.unmount();
    workspace.close();
});

describe('a chat in Chats that suggests a project', () => {
    test('shows the name, the folder and the reason, with Review and Decline', () => {
        const text = card()!.textContent!;
        expect(text).toContain('Vinyl shelf');
        expect(text).toContain('/work/vinyl-shelf');
        expect(text).toContain('The notes became a codebase');
        expect(buttonIn(card(), 'Review…')).not.toBeNull();
        expect(buttonIn(card(), 'Decline')).not.toBeNull();
        expect(machine.requests('chat.move')).toHaveLength(0);
    });

    test('Review opens the dialog filled in, and Make project sends one chat.move for the suggested folder', async () => {
        await clickOn(buttonIn(card(), 'Review…'));
        await until(() => dialog() !== null);
        await until(() => dialog()!.textContent!.includes('Where this chat worked'));
        expect(dialog()!.querySelector<HTMLInputElement>('#move-chat-name')!.value).toBe('Vinyl shelf');
        // Nothing is made by looking.
        expect(machine.requests('chat.move')).toHaveLength(0);
        await until(() => !buttonIn(dialog(), 'Make project')!.disabled);
        await clickOn(buttonIn(dialog(), 'Make project'));
        await until(() => useProject.getState().current?.projectId === VINYL.projectId);
        expect(machine.requests('chat.move')).toEqual([
            { chatId: CHAT.id, to: { folder: '/work/vinyl-shelf', name: 'Vinyl shelf', createFolder: false, initGit: false }, ownFiles: 'leave' }
        ]);
    });

    test('Decline tells the machine and makes nothing', async () => {
        await clickOn(buttonIn(card(), 'Decline'));
        await until(() => machine.requests('chat.proposalDecline').length === 1);
        expect(machine.requests('chat.proposalDecline')).toEqual([{ proposalId: PROPOSAL.proposalId }]);
        expect(machine.requests('chat.move')).toHaveLength(0);
        expect(dialog()).toBeNull();
    });

    test('goes when the machine tells that the list is empty', async () => {
        await act(async () => useProposals.getState().setProposals(ENDPOINT_ID, []));
        await until(() => card() === null);
    });
});
