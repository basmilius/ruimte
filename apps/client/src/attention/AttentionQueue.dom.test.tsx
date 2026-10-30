import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { act } from 'react';
import type { ChatApprovalItem, ChatInfo, ChatItem, ChatQuestionItem, ProjectView } from '@ruimte/contracts';
import { PROMPT_SAMPLES } from '@adecore/agents-react/testing';
import { isApplePlatform } from '@/desktop/bridge';
import { useAttention } from '@/state/attention';
import { endpointKey } from '@/state/keys';
import { useSnoozes } from '@/state/snooze';
import { useProject } from '@/state/project';
import { useDocument } from '@/state/document';
import { useChats } from '@adecore/agents-react/state';
import { useEndpoints } from '@/state/endpoints';
import { enterWorkspace } from '@/transport/connections';
import { closeAttentionQueue } from './queue';
import { chatInfoOf } from '../../testing/chat-info';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, pressKey, until, type Mounted } from '../../testing/dom';
import { emptyCanvas } from '../../testing/project-fixtures';

const NOW = Date.UTC(2026, 9, 30, 10);
const REMOTE = 'queue-remote-machine';
const matchMedia = window.matchMedia;
const MAIN = emptyCanvas();
const APPROVAL: ProjectView = { kind: 'chat', id: 'build', name: 'Build checks', node: {} };
const QUESTION: ProjectView = { kind: 'chat', id: 'database', name: 'Database choice', node: {} };
const FINISHED: ProjectView = { kind: 'chat', id: 'finished', name: 'Release notes', node: {} };
const TERMINAL: ProjectView = { kind: 'terminal', id: 'terminal', name: 'Terminal review', node: {} };
const WRITE: ChatApprovalItem = {
    ...(PROMPT_SAMPLES.find((sample) => sample.label === 'Permission · Command')!.items[0] as ChatApprovalItem),
    id: 'write',
    requestId: 'write',
    createdAt: NOW - 6 * 60_000
};
const ASK: ChatQuestionItem = {
    ...(PROMPT_SAMPLES.find((sample) => sample.label === 'Question · Single choice')!.items[0] as ChatQuestionItem),
    id: 'ask',
    requestId: 'ask',
    createdAt: NOW - 12 * 60_000
};
const REPLY: ChatItem = {
    id: 'reply',
    kind: 'assistant',
    turnId: null,
    createdAt: NOW - 60_000,
    text: 'The release notes are ready.\nThe second line stays out of the excerpt.',
    streaming: false
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let infos: Record<string, ChatInfo>;
let previousUnseen: Record<string, true>;
let disconnectRemote: (() => void) | null;

function dialog(): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((element) => element.textContent?.includes('Attention queue')) ?? null;
}

async function openQueue(): Promise<void> {
    const apple = isApplePlatform();
    await pressKey(document.body, 'p', { altKey: true, shiftKey: true, metaKey: apple, ctrlKey: !apple });
    await until(() => dialog() !== null);
}

function button(text: string): HTMLElement | null {
    return [...(dialog()?.querySelectorAll<HTMLElement>('button') ?? [])].find((element) => element.textContent?.trim() === text) ?? null;
}

beforeEach(async () => {
    disconnectRemote = null;
    previousUnseen = useAttention.getState().unseen;
    setSystemTime(NOW);
    machine = new FakeMachine();
    infos = {
        [APPROVAL.id]: chatInfoOf(APPROVAL.id, {
            status: 'needs-you',
            requests: [
                {
                    itemId: WRITE.id,
                    requestId: WRITE.requestId,
                    kind: 'approval',
                    createdAt: WRITE.createdAt,
                    approval: { toolName: 'Bash', subject: 'bun test', description: null, command: 'bun test', canAllowAlways: false }
                }
            ]
        }),
        [QUESTION.id]: chatInfoOf(QUESTION.id, {
            status: 'needs-you',
            requests: [{ itemId: ASK.id, requestId: ASK.requestId, kind: 'question', createdAt: ASK.createdAt, question: { questions: ASK.questions } }]
        }),
        [FINISHED.id]: chatInfoOf(FINISHED.id)
    };
    const items: Record<string, ChatItem[]> = { [APPROVAL.id]: [WRITE], [QUESTION.id]: [ASK], [FINISHED.id]: [REPLY] };
    machine.answer('chat.list', () => ({ chats: Object.values(infos) }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: infos[chatId] ?? chatInfoOf(chatId), items: items[chatId] ?? [] }));
    machine.answer('chat.approve', ({ chatId }) => {
        infos[chatId] = chatInfoOf(chatId);
        items[chatId] = [];
        machine.emit('chat.status', { chatId, info: infos[chatId] });
        return {};
    });
    workspace = await openFakeWorkspace(machine, { views: [MAIN, QUESTION, APPROVAL, FINISHED, TERMINAL] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await act(async () => {
        for (const [chatId, info] of Object.entries(infos)) {
            machine.emit('chat.status', { chatId, info });
        }
    });
});

afterEach(async () => {
    await act(async () => {
        closeAttentionQueue();
        useAttention.setState({ unseen: previousUnseen });
    });
    await page.unmount();
    workspace.close();
    disconnectRemote?.();
    useEndpoints.getState().remove(REMOTE);
    window.matchMedia = matchMedia;
    setSystemTime();
});

describe('the attention queue', () => {
    test('opens from its modifier shortcut, prioritizes approval over an older question and answers without opening the chat', async () => {
        await openQueue();
        await until(() => button('Allow') !== null);
        const rows = [...dialog()!.querySelectorAll('[aria-pressed]')];
        await until(() => document.activeElement === rows[0]);
        expect(rows[0]!.textContent).toContain('Build checks');
        expect(rows[1]!.textContent).toContain('Database choice');
        expect(rows[0]!.textContent).toContain('Approval');
        expect(rows[0]!.querySelector('time')!.textContent).toBe('6 min');
        expect(rows[1]!.querySelector('time')!.getAttribute('aria-label')).toBe('Waiting for 12 min, at least ten minutes');

        await clickOn(button('Allow'));
        await until(() => dialog()!.querySelectorAll('[aria-pressed]').length === 1);
        expect(machine.requests('chat.approve')[0]).toMatchObject({ chatId: APPROVAL.id, requestId: WRITE.requestId, decision: 'allow' });
        expect(dialog()!.querySelector('[aria-pressed="true"]')!.textContent).toContain('Database choice');
        await until(() => document.activeElement === dialog()!.querySelector('[aria-pressed="true"]'));
        expect(page.host.querySelector('[data-split-cell][data-view-id="main"]')).not.toBeNull();
    });

    test('shows the same priority and age on the sidebar and leaves snoozed waits out of the queue', async () => {
        const rows = (): Element[] => [...page.host.querySelectorAll('[data-sidebar-row^="needs:"]')];
        await until(() => rows().length === 2);
        expect(rows()[0]!.textContent).toContain('Build checks');
        expect(rows()[0]!.querySelector('time')!.textContent).toBe('6 min');

        await act(async () => useSnoozes.getState().receive('fake-machine', [{ nodeId: APPROVAL.id, until: NOW + 60_000 }]));
        await openQueue();
        expect(dialog()!.querySelectorAll('[aria-pressed]')).toHaveLength(1);
        expect(dialog()!.textContent).not.toContain('Build checks');
        await act(async () => useSnoozes.getState().receive('fake-machine', []));
    });

    test('reads an existing finished-message excerpt without starting a turn', async () => {
        await act(async () => {
            machine.emit('chat.status', { chatId: APPROVAL.id, info: chatInfoOf(APPROVAL.id) });
            machine.emit('chat.status', { chatId: QUESTION.id, info: chatInfoOf(QUESTION.id) });
            useAttention.setState({ unseen: { [endpointKey('fake-machine', FINISHED.id)]: true } });
        });
        await openQueue();
        await until(() => dialog()!.textContent?.includes('The release notes are ready.') === true);
        expect(dialog()!.textContent).not.toContain('The second line stays out');
        expect(machine.requests('chat.send')).toEqual([]);
        expect(machine.requests('chat.approve')).toEqual([]);
        expect(page.host.querySelector('[data-split-cell][data-view-id="main"]')).not.toBeNull();
    });

    test('reveals a waiting terminal without typing an answer into it', async () => {
        await act(async () => {
            machine.emit('chat.status', { chatId: APPROVAL.id, info: chatInfoOf(APPROVAL.id) });
            machine.emit('chat.status', { chatId: QUESTION.id, info: chatInfoOf(QUESTION.id) });
            machine.emit('session.status', {
                sessionId: TERMINAL.id,
                agent: {
                    kind: 'claude',
                    agentSessionId: 'terminal-agent',
                    transcriptPath: null,
                    status: 'needs-you',
                    live: true,
                    updatedAt: NOW - 60_000,
                    requests: [
                        {
                            id: 'terminal-question',
                            source: 'hook',
                            kind: 'question',
                            toolName: 'AskUserQuestion',
                            title: null,
                            text: 'Which database?',
                            createdAt: NOW - 2 * 60_000
                        },
                        { id: 'terminal-request', source: 'hook', kind: 'approval', toolName: 'Bash', title: null, text: 'bun test', createdAt: NOW - 60_000 }
                    ]
                }
            });
        });
        await openQueue();
        await until(() => button('Go to terminal') !== null);
        expect(dialog()!.textContent).not.toContain('Which database?');
        await clickOn(button('Go to terminal'));
        await until(() => dialog() === null);
        expect(page.host.querySelector(`[data-split-cell][data-view-id="${TERMINAL.id}"]`)).not.toBeNull();
        expect(machine.requests('session.write')).toEqual([]);
        expect(machine.requests('chat.approve')).toEqual([]);
    });

    test('an empty queue inspects no chat', async () => {
        await act(async () => {
            machine.emit('chat.status', { chatId: APPROVAL.id, info: chatInfoOf(APPROVAL.id) });
            machine.emit('chat.status', { chatId: QUESTION.id, info: chatInfoOf(QUESTION.id) });
        });
        const reads = machine.requests('chat.attach').length;

        await openQueue();
        expect(dialog()!.textContent).toContain('Nothing is waiting or finished unseen.');
        expect(machine.requests('chat.attach')).toHaveLength(reads);
    });

    test('a failed preview can be retried without starting a chat turn', async () => {
        machine.answer('chat.attach', () => Promise.reject(new Error('The preview could not be read.')));
        await openQueue();
        await until(() => button('Try again') !== null);
        expect(button('Open session')).not.toBeNull();
        machine.answer('chat.attach', ({ chatId }) => ({ info: infos[chatId] ?? chatInfoOf(chatId), items: chatId === APPROVAL.id ? [WRITE] : [ASK] }));

        await clickOn(button('Try again'));
        await until(() => button('Allow') !== null);
        expect(machine.requests('chat.send')).toEqual([]);
    });

    test('switching projects closes the queue and returning does not reopen it', async () => {
        const original = useProject.getState().current!;
        machine.answer('project.open', ({ projectId }) => ({
            summary: { ...original, projectId: projectId!, name: projectId === original.projectId ? 'Atlas' : 'Other project' },
            document: {
                version: 3 as const,
                rev: 1,
                name: 'Project',
                color: '#000000',
                views: projectId === original.projectId ? [MAIN, QUESTION, APPROVAL] : [emptyCanvas('other-main', 'Other view')]
            },
            local: { activeViewId: projectId === original.projectId ? MAIN.id : 'other-main', views: {} }
        }));
        await openQueue();
        await act(async () => enterWorkspace('fake-machine', { projectId: 'other-project' }));
        await until(() => dialog() === null);
        await act(async () => enterWorkspace('fake-machine', { projectId: original.projectId }));
        await until(() => page.host.querySelector('[data-split-cell][data-view-id="main"]') !== null);
        expect(dialog()).toBeNull();
    });

    test('one chat opens the approval its row names before an older blocking question', async () => {
        infos[APPROVAL.id] = { ...infos[APPROVAL.id]!, requests: [infos[QUESTION.id]!.requests![0]!, infos[APPROVAL.id]!.requests![0]!] };
        machine.answer('chat.attach', ({ chatId }) => ({ info: infos[chatId] ?? chatInfoOf(chatId), items: chatId === APPROVAL.id ? [ASK, WRITE] : [ASK] }));
        await act(async () => machine.emit('chat.status', { chatId: APPROVAL.id, info: infos[APPROVAL.id]! }));

        await openQueue();
        await until(() => button('Allow') !== null);
        expect(button('Answer')).toBeNull();
    });

    test('a waiting session without a preview card offers a route to the session rather than loading forever', async () => {
        infos[APPROVAL.id] = chatInfoOf(APPROVAL.id, { status: 'needs-you' });
        machine.answer('chat.attach', ({ chatId }) => ({ info: infos[chatId] ?? chatInfoOf(chatId), items: [] }));
        await act(async () => {
            machine.emit('chat.status', { chatId: APPROVAL.id, info: infos[APPROVAL.id]! });
            machine.emit('chat.status', { chatId: QUESTION.id, info: chatInfoOf(QUESTION.id) });
        });

        await openQueue();
        await until(() => dialog()!.textContent?.includes('Open the session to answer.') === true);
        expect(button('Open session')).not.toBeNull();
        expect(dialog()!.textContent).not.toContain('Loading');
    });

    test('a narrow queue moves focus into the detail and restores the selected row on Back', async () => {
        window.matchMedia = (query) => {
            const list = matchMedia.call(window, query);

            if (query === '(min-width: 768px)') {
                Object.defineProperty(list, 'matches', { value: false });
            }

            return list;
        };
        await openQueue();
        const row = dialog()!.querySelector<HTMLElement>('[aria-pressed="true"]')!;

        await clickOn(row);
        await until(() => document.activeElement === button('Back to list'));
        await clickOn(button('Back to list'));
        await until(() => document.activeElement === row);
    });

    test('a hidden inline chat can be answered without offering an invalid open-view link', async () => {
        const hidden: ProjectView = { kind: 'chat', id: 'inline', name: 'Inline change', node: {}, hidden: true };
        const info = chatInfoOf(hidden.id, { status: 'needs-you', requests: infos[APPROVAL.id]!.requests });
        machine.answer('chat.attach', () => ({ info, items: [WRITE] }));
        await act(async () => {
            useDocument.setState((state) => ({ views: [...state.views, hidden] }));
            machine.emit('chat.status', { chatId: APPROVAL.id, info: chatInfoOf(APPROVAL.id) });
            machine.emit('chat.status', { chatId: QUESTION.id, info: chatInfoOf(QUESTION.id) });
            machine.emit('chat.status', { chatId: hidden.id, info });
        });

        await openQueue();
        await until(() => button('Allow') !== null);
        expect(button('Open session')).toBeNull();
        expect(button('Inline change')).toBeNull();
        await clickOn(button('Allow'));
        await until(() => machine.requests('chat.approve').length === 1);
        expect(machine.requests('chat.approve')[0]).toMatchObject({ chatId: hidden.id, requestId: WRITE.requestId });
        expect(page.host.querySelector('[data-split-cell][data-view-id="main"]')).not.toBeNull();
    });

    test('an approval from another machine goes only to that machine', async () => {
        await page.unmount();
        workspace.close();
        const there = new FakeMachine();
        const info = chatInfoOf('remote-review', { status: 'needs-you', requests: infos[APPROVAL.id]!.requests });
        there.answer('chat.list', () => ({ chats: [info] }));
        there.answer('chat.attach', () => ({ info, items: [WRITE] }));
        machine.answer('remote.list', () => ({
            links: [{ machineId: REMOTE, remoteProjectId: 'remote-project', label: 'Review machine', rootCommit: 'abc' }]
        }));
        infos[APPROVAL.id] = chatInfoOf(APPROVAL.id);
        infos[QUESTION.id] = chatInfoOf(QUESTION.id);
        useEndpoints.getState().add({
            id: REMOTE,
            label: 'Review machine',
            httpBaseUrl: 'http://127.0.0.1:2',
            wsBaseUrl: 'ws://127.0.0.1:2',
            reachability: 'lan',
            daemonId: null,
            daemonPublicKey: null
        });
        disconnectRemote = connectFakeMachine(there, REMOTE);
        const remoteView = {
            ...emptyCanvas('remote-view', 'Review'),
            nodes: [
                { id: info.chatId, kind: 'chat' as const, title: 'Remote review', provider: 'claude' as const, machine: REMOTE, x: 0, y: 0, w: 480, h: 520 }
            ]
        };
        workspace = await openFakeWorkspace(machine, { views: [MAIN, remoteView] }, { activeViewId: remoteView.id, views: {} });
        page = mount();
        await page.renderApp();
        await until(() => useChats.getState().statusByKey[endpointKey(REMOTE, info.chatId)]?.info.status === 'needs-you');

        await openQueue();
        await until(() => button('Allow') !== null);
        await clickOn(button('Allow'));
        await until(() => there.requests('chat.approve').length === 1);
        expect(there.requests('chat.approve')[0]).toMatchObject({ chatId: info.chatId, requestId: WRITE.requestId, decision: 'allow' });
        expect(machine.requests('chat.approve')).toEqual([]);
    });
});
