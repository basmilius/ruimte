import { afterEach, describe, expect, test } from 'bun:test';
import { PROMPT_SAMPLES } from '@adecore/agents-react/testing';
import type { ChatApprovalItem, ChatQuestionItem, ChatSubagentItem, ProjectView } from '@ruimte/contracts';
import { act } from 'react';
import { chatInfoOf } from '../../testing/chat-info';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const CHILD: ChatSubagentItem = {
    id: 'agent-reviewer',
    kind: 'subagent',
    turnId: null,
    createdAt: 1,
    toolUseId: 'spawn-reviewer',
    description: 'Review the changes',
    subagentType: null,
    prompt: null,
    background: true,
    status: 'running',
    startedAt: 1,
    finishedAt: null,
    summary: null,
    result: null,
    usage: null,
    lastTool: null,
    itemsTruncated: false,
    origin: 'ruimte',
    childId: 'reviewer'
};
const APPROVAL = PROMPT_SAMPLES.find((sample) => sample.label === 'Permission · Command')!.items[0] as ChatApprovalItem;
const QUESTION = PROMPT_SAMPLES.find((sample) => sample.label === 'Question · Single choice')!.items[0] as ChatQuestionItem;
let page: Mounted | undefined;
let workspace: FakeWorkspace | undefined;

afterEach(async () => {
    await page?.unmount();
    workspace?.close();
});

describe('sub-agent prompts in the main chat', () => {
    test.each([
        { request: APPROVAL, surface: 'chat' },
        { request: QUESTION, surface: 'chat' },
        { request: APPROVAL, surface: 'canvas' },
        { request: QUESTION, surface: 'canvas' }
    ])('answers a child $request.kind from its main $surface without opening the child conversation', async ({ request, surface }) => {
        const machine = new FakeMachine();
        const info = chatInfoOf('reviewer', {
            status: 'needs-you',
            requests: [{ requestId: request.requestId, itemId: request.id, kind: request.kind, createdAt: request.createdAt }]
        });
        machine.answer('chat.list', () => ({ chats: [info] }));
        machine.answer('chat.attach', ({ chatId }) =>
            chatId === 'reviewer'
                ? { info, items: [], history: { start: 10, cursor: 'older-items' }, pending: [request] }
                : { info: chatInfoOf(chatId), items: [CHILD] }
        );
        const view: ProjectView =
            surface === 'chat'
                ? { kind: 'chat', id: 'main-chat', name: 'Main', node: { provider: 'claude' } }
                : {
                      kind: 'canvas',
                      id: 'main-canvas',
                      name: 'Main',
                      nodes: [{ kind: 'chat', id: 'main-chat', title: 'Main agent', x: 0, y: 0, w: 480, h: 520 }],
                      texts: [],
                      edges: [],
                      layouts: []
                  };
        workspace = await openFakeWorkspace(
            machine,
            {
                views: [view]
            },
            { activeViewId: view.id, views: {} }
        );
        page = mount();
        await page.renderApp();
        await until(() => page!.host.querySelector('.prompt-card') !== null);
        const card = page.host.querySelector('.prompt-card')!;
        expect(card.textContent).toContain('Review the changes');
        const button = (label: string) => [...card.querySelectorAll('button')].find((entry) => entry.textContent?.trim() === label) ?? null;
        if (request.kind === 'approval') {
            await act(async () => machine.drop());
            expect((button('Allow') as HTMLButtonElement).disabled).toBe(true);
            await clickOn(button('Allow'));
            expect(machine.requests('chat.approve')).toEqual([]);
            await act(async () => machine.reopen());
            await until(() => !(button('Allow') as HTMLButtonElement).disabled);
            await clickOn(button('Allow'));
            await until(() => machine.requests('chat.approve').length === 1);
            expect(machine.requests('chat.approve')[0]).toMatchObject({ chatId: 'reviewer', requestId: request.requestId, decision: 'allow' });
        } else {
            await clickOn([...card.querySelectorAll('[role="radio"]')].find((entry) => entry.textContent?.includes('All three')) ?? null);
            await clickOn(button('Answer'));
            await until(() => machine.requests('chat.answer').length === 1);
            expect(machine.requests('chat.answer')[0]).toMatchObject({ chatId: 'reviewer', requestId: request.requestId, answers: { endpoints: 'All three' } });
        }
        await act(async () => machine.emit('chat.status', { chatId: 'reviewer', info: chatInfoOf('reviewer') }));
        await until(() => page!.host.querySelector('.prompt-card') === null);
        expect(machine.requests('chat.subagent')).toEqual([]);
    });
});
