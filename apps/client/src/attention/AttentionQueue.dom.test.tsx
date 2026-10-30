import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { act } from 'react';
import type { ChatApprovalItem, ChatInfo, ChatItem, ChatQuestionItem, ProjectView } from '@ruimte/contracts';
import { PROMPT_SAMPLES } from '@adecore/agents-react/testing';
import { isApplePlatform } from '@/desktop/bridge';
import { useAttention } from '@/state/attention';
import { endpointKey } from '@/state/keys';
import { useSnoozes } from '@/state/snooze';
import { useProject } from '@/state/project';
import { enterWorkspace } from '@/transport/connections';
import { closeAttentionQueue } from './queue';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, pressKey, until, type Mounted } from '../../testing/dom';
import { emptyCanvas } from '../../testing/project-fixtures';

const NOW = Date.UTC(2026, 9, 30, 10);
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
                        { id: 'terminal-request', source: 'hook', kind: 'approval', toolName: 'Bash', title: null, text: 'bun test', createdAt: NOW - 60_000 }
                    ]
                }
            });
        });
        await openQueue();
        await until(() => button('Go to terminal') !== null);
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
});
