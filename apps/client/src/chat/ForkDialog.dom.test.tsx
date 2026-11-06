import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readDraft } from '@adecore/agents-react/chat';
import { useChats } from '@adecore/agents-react/state';
import type { ProjectCanvasView, ProjectNode, RemoteLink } from '@ruimte/contracts';
import { act } from 'react';
import { forkDialog } from '@/chat/dialogs';
import { remoteNodeDialog } from '@/machine-ui/dialogs';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { claudeProvider } from '../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { gitIdentity, idleChatInfo, projectSummary } from '../../testing/project-fixtures';

const REMOTE = 'machine-b';
const LEAD: ProjectNode = { id: 'chat-lead', kind: 'chat', title: 'Lexer', x: 0, y: 0, w: 560, h: 640, provider: 'claude' };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [LEAD], texts: [], edges: [], layouts: [] };

const CLAUDE = claudeProvider({
    chat: true,
    terminal: true,
    hooks: true,
    attachments: true,
    mentions: true,
    denyReason: true,
    allowAlways: true,
    slashCommands: true
});

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
    here.answer('provider.list', () => ({ providers: [CLAUDE] }));
    here.answer(
        'chat.attach',
        () =>
            ({
                info: idleChatInfo(LEAD.id),
                items: [
                    { id: 'turn-1', kind: 'turn', createdAt: 1, turnId: 'turn-1', state: 'done', endedAt: 2, costUsd: 0 },
                    { id: 'user-1', kind: 'user', createdAt: 1, turnId: 'turn-1', text: 'Write the lexer' }
                ],
                seq: 1
            }) as never
    );
    here.answer('git.identity', () => ({ identities: [gitIdentity('/work/atlas', ['root-a'])] }));
    here.answer('chat.forkInfo', () => ({ repository: true, branches: ['main'], branch: 'alternative', filesAfterTurn: false }));
    here.answer('chat.fork', () => ({
        info: { ...idleChatInfo(LEAD.id), chatId: 'forked' },
        nodeId: 'forked',
        viewId: MAIN.id,
        edgeId: null,
        worktree: { path: '/work/alternative', branch: 'alternative' }
    }));
    here.answer('chat.handoff', () => {
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
    there = new FakeMachine();
    there.answer('provider.list', () => ({ providers: [CLAUDE] }));
    there.answer('project.list', () => ({ projects: [projectSummary('ruimte', 'ruimte', '/Users/b/ruimte')] }));
    there.answer('git.identity', ({ paths }) => ({ identities: paths.map((path) => gitIdentity(path, ['root-a'])) }));
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
    await act(async () => forkDialog.set({ chatId: LEAD.id, turnId: 'turn-1' }));
    await until(() => dialog()?.textContent?.includes('Fork') === true);
});

afterEach(async () => {
    await act(async () => {
        forkDialog.set(null);
        remoteNodeDialog.set(null);
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

describe('forking a chat', () => {
    test('a local worktree waits for Fork, and Cancel sends no fork request', async () => {
        await until(() => button('Fork')?.hasAttribute('disabled') === false);
        expect(dialog()?.textContent).toContain('git worktree');
        expect((dialog()?.querySelector('#fork-branch') as HTMLInputElement | null)?.value).toBe('alternative');
        expect(here.requests('chat.fork')).toEqual([]);
        await clickOn(button('Cancel'));
        await until(() => dialog() === null);
        expect(here.requests('chat.fork')).toEqual([]);

        await act(async () => forkDialog.set({ chatId: LEAD.id, turnId: 'turn-1' }));
        await until(() => button('Fork')?.hasAttribute('disabled') === false);
        expect(here.requests('chat.fork')).toEqual([]);
        await clickOn(button('Fork'));
        await until(() => dialog() === null);
        expect(here.requests('chat.fork')).toEqual([{ chatId: LEAD.id, turnId: 'turn-1', title: 'Lexer (fork)', worktree: { branch: 'alternative' } }]);
    });
});

describe('forking a chat to another machine', () => {
    test('offers this machine first and the others next', async () => {
        await clickOn(dialog()?.querySelector('[aria-label="Machine"]') ?? null);
        await until(() => document.querySelector('[role="option"]') !== null);
        expect([...document.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual(['This machine', 'MacBook Pro']);
    });

    test('choosing another machine drops the worktree fields and hands the turn to the checkout dialog', async () => {
        await pickMachine();
        await until(() => button('Choose a checkout…') !== null);
        expect(dialog()?.textContent).not.toContain('git worktree');
        await clickOn(button('Choose a checkout…'));

        await until(() => dialog()?.textContent?.includes('New chat on MacBook Pro') === true);
        expect(remoteNodeDialog.get()?.handoff).toMatchObject({ chatId: LEAD.id, turnId: 'turn-1', title: 'Lexer (fork)' });
        expect(here.requests('chat.fork')).toEqual([]);
    });

    test('Create asks this machine for the handoff before the node is saved, and seeds it as the first message', async () => {
        await pickMachine();
        await clickOn(button('Choose a checkout…'));
        await until(() => dialog()?.textContent?.includes('/Users/b/ruimte') === true);
        await until(() => button('Create')?.hasAttribute('disabled') === false);
        await clickOn(button('Create'));

        await until(() => order.includes('peer.placeNodes'));
        expect(order).toEqual(['chat.handoff', 'project.save', 'peer.placeNodes']);
        expect(here.requests('chat.handoff')[0]).toEqual({ chatId: LEAD.id, turnId: 'turn-1', remote: { machine: 'Fake machine', cwd: '/Users/b/ruimte' } });
        const saved = here.requests('project.save').at(-1)!.content.views[0] as ProjectCanvasView;
        const made = saved.nodes.find((node) => node.machine === REMOTE)!;
        expect(made).toMatchObject({ kind: 'chat', title: 'Lexer (fork)' });
        expect(readDraft(made.id).text).toBe('HANDOFF TEXT');
    });
});
