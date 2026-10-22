import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ChatInfo, GitIdentity, ProjectCanvasView, ProjectNode, ProjectSummary, ProviderInfo, RemoteLink } from '@ruimte/contracts';
import { readDraft } from '@adecore/agents-react/chat';
import { useChats } from '@adecore/agents-react/state';
import { nodesOfView } from '@/project/view-nodes';
import { useDocument } from '@/state/document';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useUi } from '@/state/ui';
import { CHAT_HOST } from '@/chat/host';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, openSubmenu, until, type Mounted } from '../../testing/dom';

const REMOTE = 'machine-b';
// The chat runs on the other machine, which holds its conversation.
const LEAD: ProjectNode = { id: 'chat-lead', kind: 'chat', title: 'Lexer', machine: REMOTE, x: 0, y: 0, w: 560, h: 640, provider: 'claude' };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [LEAD], texts: [], edges: [], layouts: [] };

const CLAUDE = {
    kind: 'claude',
    name: 'Claude Code',
    installed: true,
    version: '2.1.0',
    models: [{ slug: 'model', name: 'Model', legacy: false, isDefault: true, options: [] }],
    defaultModel: 'model',
    capabilities: { chat: true, terminal: true, hooks: true, attachments: true, mentions: true, denyReason: true, allowAlways: true, slashCommands: true },
    resumeCommand: 'claude --resume {id}'
} as unknown as ProviderInfo;

function summary(projectId: string, name: string, folder: string): ProjectSummary {
    return {
        projectId,
        name,
        color: '#000',
        folder,
        lastOpenedAt: 0,
        closedAt: null,
        available: true,
        icon: { kind: 'initial', value: name[0]! },
        nameSource: 'chosen'
    };
}

function identity(path: string, rootCommits: string[]): GitIdentity {
    return { path, rootCommits, branch: 'main', heads: [] };
}

const INFO = {
    chatId: LEAD.id,
    provider: 'claude',
    cwd: '/work/atlas',
    agentSessionId: 'session-1',
    model: null,
    selection: { model: 'model', options: {} },
    runtimeMode: 'supervised',
    status: 'idle',
    running: false,
    activeTurnId: null,
    slashCommands: [],
    usage: { turns: 1, contextTokens: 0, contextWindow: 200_000, costUsd: 0 },
    background: []
} as unknown as ChatInfo;

let here: FakeMachine;
let there: FakeMachine;
let workspace: FakeWorkspace;
let disconnectThere: () => void;
let page: Mounted;
let order: string[];
let links: RemoteLink[];

function dialog(): HTMLElement | null {
    return document.querySelector('[role="dialog"]');
}

function button(text: string): HTMLElement | null {
    return ([...(dialog()?.querySelectorAll('button') ?? [])] as HTMLElement[]).find((candidate) => candidate.textContent?.includes(text)) ?? null;
}

beforeEach(async () => {
    order = [];
    links = [];
    here = new FakeMachine();
    there = new FakeMachine();
    here.answer('provider.list', () => ({ providers: [CLAUDE] }));
    there.answer(
        'chat.attach',
        () =>
            ({
                info: INFO,
                items: [
                    { id: 'turn-1', kind: 'turn', createdAt: 1, turnId: 'turn-1', state: 'done', endedAt: 2, costUsd: 0 },
                    { id: 'user-1', kind: 'user', createdAt: 1, turnId: 'turn-1', text: 'Write the lexer' }
                ],
                seq: 1
            }) as never
    );
    here.answer('git.identity', () => ({ identities: [identity('/work/atlas', ['root-a'])] }));
    here.answer('chat.handoff', () => {
        order.push('chat.handoff here');
        return { text: 'WRONG MACHINE', turns: 1, all: true };
    });
    there.answer('chat.handoff', () => {
        order.push('chat.handoff');
        return { text: 'HANDOFF TEXT', turns: 1, all: true };
    });
    here.answer('project.save', ({ baseRev }) => {
        order.push('project.save');
        return { rev: baseRev + 1 } as never;
    });
    here.answer('remote.list', () => ({ links }));
    here.answer('remote.link', (payload) => {
        const { projectId: _projectId, ...link } = payload;
        links = [link];
        return link;
    });
    there.answer('provider.list', () => ({ providers: [CLAUDE] }));
    there.answer('project.list', () => ({ projects: [summary('ruimte', 'ruimte', '/Users/b/ruimte')] }));
    there.answer('git.identity', ({ paths }) => ({ identities: paths.map((path) => identity(path, ['root-a'])) }));
    there.answer('peer.bind', (payload) => ({ ...payload, projectName: 'ruimte', ceiling: 'supervised' as const, createdAt: 1 }));
    there.answer('peer.placeNodes', () => {
        order.push('peer.placeNodes');
        return {};
    });
    useEndpoints.getState().add({
        id: REMOTE,
        label: 'MacBook Pro',
        httpBaseUrl: 'http://127.0.0.1:2',
        wsBaseUrl: 'ws://127.0.0.1:2',
        reachability: 'lan',
        daemonId: null,
        daemonPublicKey: null
    });
    disconnectThere = connectFakeMachine(there, REMOTE);
    workspace = await openFakeWorkspace(here, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => Object.values(useChats.getState().byKey).some((row) => row.structure?.['turn-1'] !== undefined));
    await act(async () => {
        page.host
            .querySelector(`[data-node-id="${LEAD.id}"]`)!
            .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40, button: 2 }));
    });
    await until(() => document.querySelector('[role="menu"]') !== null);
    await openSubmenu('Conversation');
    await clickOn([...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent?.includes('Fork')) ?? null);
    await until(() => dialog()?.textContent?.includes('Fork') === true);
});

afterEach(async () => {
    await act(async () => {
        useUi.getState().setForkDialog(null);
        useUi.getState().setRemoteNodeDialog(null);
    });
    await page.unmount();
    workspace.close();
    disconnectThere();
    useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
    useEndpoints.getState().remove(REMOTE);
});

async function pickMachine(): Promise<void> {
    await clickOn(dialog()?.querySelector('[aria-label="Machine"]') ?? null);
    await until(() => document.querySelector('[role="option"]') !== null);
    await clickOn([...document.querySelectorAll('[role="option"]')].find((option) => option.textContent?.includes('MacBook Pro')) ?? null);
}

describe('forking a chat that runs on another machine', () => {
    test('reads the chat and its turn on that machine, and offers a transcript of it here', async () => {
        await until(() => button('Fork')?.hasAttribute('disabled') === false);

        expect(useUi.getState().forkDialog).toEqual({ chatId: LEAD.id, turnId: 'turn-1', machine: REMOTE });
        expect(dialog()?.textContent).toContain('A new chat node here starts from a transcript of this one');
        expect(dialog()?.textContent).not.toContain('git worktree');
        expect(here.requests('chat.forkInfo')).toEqual([]);
    });

    test('the fork button in its thread names that machine too', async () => {
        await act(async () => useUi.getState().setForkDialog(null));
        await act(async () => CHAT_HOST.fork!(LEAD.id, 'turn-1'));

        expect(useUi.getState().forkDialog).toEqual({ chatId: LEAD.id, turnId: 'turn-1', machine: REMOTE });
    });

    test('Fork here asks that machine for the transcript and seeds a chat node on this machine with it', async () => {
        await until(() => button('Fork')?.hasAttribute('disabled') === false);
        await clickOn(button('Fork'));
        await until(() => dialog() === null);

        expect(order).toEqual(['chat.handoff']);
        expect(there.requests('chat.handoff')).toEqual([{ chatId: LEAD.id, turnId: 'turn-1', remote: { machine: 'MacBook Pro', cwd: '/work/atlas' } }]);
        expect(here.requests('chat.fork')).toEqual([]);
        expect(there.requests('chat.fork')).toEqual([]);
        const made = useDocument
            .getState()
            .views.flatMap((view) => nodesOfView(view))
            .find((node) => node.kind === 'chat' && node.id !== LEAD.id)!;
        expect(made).toMatchObject({ title: 'Lexer (fork)', provider: 'claude' });
        expect(made.machine).toBeUndefined();
        expect(readDraft(made.id).text).toBe('HANDOFF TEXT');
    });

    test('onto its own machine, the checkout dialog asks that machine for the transcript', async () => {
        await pickMachine();
        await clickOn(button('Choose a checkout…'));
        await until(() => dialog()?.textContent?.includes('/Users/b/ruimte') === true);
        expect(useUi.getState().remoteNodeDialog?.handoff).toMatchObject({ chatId: LEAD.id, source: REMOTE });
        await until(() => button('Create')?.hasAttribute('disabled') === false);
        await clickOn(button('Create'));

        await until(() => order.includes('peer.placeNodes'));
        expect(order.filter((step) => step.startsWith('chat.handoff'))).toEqual(['chat.handoff']);
        expect(there.requests('chat.handoff')[0]).toEqual({ chatId: LEAD.id, turnId: 'turn-1', remote: { machine: 'MacBook Pro', cwd: '/Users/b/ruimte' } });
        const saved = here.requests('project.save').at(-1)!.content.views[0] as ProjectCanvasView;
        const made = saved.nodes.find((node) => node.machine === REMOTE && node.id !== LEAD.id)!;
        expect(readDraft(made.id).text).toBe('HANDOFF TEXT');
    });
});
