import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { workflowAgentRef, type ChatItem, type ChatWorkflow, type ProjectCanvasView, type ProjectNode } from '@ruimte/contracts';
import { useSubagentView } from '@adecore/agents-react/chat';
import { useChats } from '@adecore/agents-react/state';
import { derivedCardId } from '@/canvas/node-body';
import { forgetWorkflowBeside } from '@/chat/workflow/workflow-beside-state';
import { focusedCanvas } from '@/state/canvas';
import { chatInfoOf } from '../../../testing/chat-info';
import { clickOn, layOutChat, mount, until, type Mounted } from '../../../testing/dom';
import { FakeMachine } from '../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../testing/fake-workspace';
import { claudeProvider } from '../../../testing/fake-provider';

const CLAUDE = claudeProvider({ chat: true, terminal: true, hooks: true, diffs: 'before-after', slashCommands: true });

const WORKFLOW: ChatWorkflow = {
    name: 'Review the branch',
    taskId: 'task-wf',
    phases: [
        { index: 1, title: 'Read' },
        { index: 2, title: 'Verify' }
    ],
    agents: [
        { index: 0, label: 'Reader', phaseIndex: 1, agentId: 'agent-reader', status: 'done', startedAt: 1000, durationMs: 4000, lastTool: 'Read' },
        { index: 1, label: 'Checker', phaseIndex: 2, agentId: 'agent-checker', status: 'running', startedAt: 6000, durationMs: null, lastTool: 'Bash' },
        { index: 2, label: 'Waiter', phaseIndex: 2, agentId: null, status: 'running', startedAt: null, durationMs: null, lastTool: null }
    ]
};

function workflowCall(state: 'running' | 'done', workflow: ChatWorkflow = WORKFLOW): ChatItem {
    return {
        id: 'wf',
        kind: 'tool',
        createdAt: 500,
        turnId: 'turn-1',
        toolUseId: 'wf',
        name: 'Workflow',
        input: {},
        output: null,
        state,
        parentToolUseId: null,
        workflow
    };
}

const USER: ChatItem = { id: 'user-1', kind: 'user', createdAt: 100, turnId: 'turn-1', text: 'Review it' };

function chatNode(patch: Partial<ProjectNode> = {}): ProjectNode {
    return { id: 'chat-lead', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 480, h: 600, provider: 'claude', ...patch } as ProjectNode;
}

// Every test its own chat, so no row or choice of one test is in the next.
let tests = 0;
let chatId: string;
let otherId: string;
let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let restoreLayout: () => void;
let items: ChatItem[];

/* A second chat node on the workspace machine that runs the workflow, so its cards prove the cards beside the canvas's chats were drawn. */
function otherNode(): ProjectNode {
    return chatNode({ id: otherId, title: 'Other', x: 2000 });
}

async function open(node: ProjectNode = chatNode(), more: ProjectNode[] = []): Promise<void> {
    const main: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [{ ...node, id: chatId }, ...more], texts: [], edges: [], layouts: [] };
    workspace = await openFakeWorkspace(machine, { views: [main] }, { activeViewId: main.id, views: {} });
    page = mount();
    await page.renderApp();
}

function cards(owner: string = chatId): HTMLElement[] {
    return [...page.host.querySelectorAll<HTMLElement>(`[data-derived-of="${owner}"]`)];
}

function card(label: string): HTMLElement | undefined {
    return cards().find((candidate) => candidate.getAttribute('aria-label') === label);
}

function button(label: string, within: ParentNode = page.host): HTMLButtonElement | null {
    return (
        [...within.querySelectorAll<HTMLButtonElement>('button')].find(
            (candidate) => candidate.getAttribute('aria-label') === label || candidate.textContent?.trim() === label
        ) ?? null
    );
}

async function emit(item: ChatItem, seq: number): Promise<void> {
    await act(async () => machine.emit('chat.event', { chatId, event: { type: 'item', item }, seq }));
}

beforeEach(() => {
    restoreLayout = layOutChat();
    tests += 1;
    chatId = `chat-workflow-${tests}`;
    otherId = `chat-other-${tests}`;
    items = [USER, workflowCall('running')];
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer(
        'chat.attach',
        ({ chatId: attached }) => ({ info: chatInfoOf(attached), items: attached === chatId ? items : [USER, workflowCall('running')], seq: 1 }) as never
    );
    machine.answer(
        'chat.subagent',
        () =>
            ({
                items: [{ id: 'note', kind: 'note', createdAt: 0, turnId: null, level: 'info', text: 'Checking the parser' }],
                pending: [],
                history: { start: 0, cursor: null },
                source: 'claude-transcript',
                live: false
            }) as never
    );
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    restoreLayout();
    forgetWorkflowBeside(() => true);
});

describe('a chat node that runs a workflow', () => {
    test('draws nothing beside it while the chat runs none', async () => {
        items = [USER];
        await open(chatNode(), [otherNode()]);
        await until(() => Object.keys(useChats.getState().byKey).some((key) => key.endsWith(chatId)));
        await until(() => cards(otherId).length > 0);
        expect(cards()).toEqual([]);
    });

    test('stands a summary and a card per phase beside it, the live phase open, and asks for no conversation before a press', async () => {
        await open();
        await until(() => cards().length > 0);
        expect(cards().map((candidate) => candidate.getAttribute('aria-label'))).toEqual(['Review the branch', 'Read', 'Verify']);
        const verify = card('Verify')!;
        expect(verify.querySelector('[data-workflow-agent="1"]')).not.toBeNull();
        expect(card('Read')!.querySelector('[data-workflow-agent="0"]')).toBeNull();
        // One still waiting has no conversation to open.
        expect(verify.querySelector<HTMLButtonElement>('[data-workflow-agent="2"]')!.disabled).toBe(true);
        expect(machine.requests('chat.subagent')).toEqual([]);
    });

    test('opens one phase at a time', async () => {
        await open();
        await until(() => card('Read') !== undefined);
        await clickOn(button('Open Read', card('Read')));
        await until(() => card('Read')!.querySelector('[data-workflow-agent="0"]') !== null);
        expect(card('Verify')!.querySelector('[data-workflow-agent="1"]')).toBeNull();
    });

    test("opens an agent's conversation beside the phases, and its close puts the keys back on the agent's line", async () => {
        await open();
        await until(() => card('Verify')?.querySelector('[data-workflow-agent="1"]') != null);
        await clickOn(card('Verify')!.querySelector('[data-workflow-agent="1"]'));
        await until(() => card('Checker') !== undefined);
        await until(() => page.host.textContent?.includes('Checking the parser') === true);
        expect(machine.requests('chat.subagent')[0]).toMatchObject({ chatId, toolUseId: workflowAgentRef('agent-checker') });
        expect(card('Verify')!.querySelector('[data-workflow-agent="1"]')!.getAttribute('aria-pressed')).toBe('true');

        await clickOn(button('Close conversation', card('Checker')));
        await until(() => card('Checker') === undefined);
        await until(() => document.activeElement?.getAttribute('data-workflow-agent') === '1');
        expect(focusedCanvas().getState().navigationId).toBe(derivedCardId(chatId, 'phase:phase-2'));
        // The conversation opened beside the node, never in the node's own place.
        expect(Object.keys(useSubagentView.getState().trails).filter((key) => key.endsWith(chatId))).toEqual([]);
    });

    test('wears the color a person gave the node', async () => {
        await open(chatNode({ accent: 'violet' } as Partial<ProjectNode>));
        await until(() => card('Read') !== undefined);
        expect(card('Read')!.querySelector<HTMLElement>('button')!.getAttribute('style')).toContain('#7f22fe');
    });

    test('stops the workflow by its task once, and offers Stop again when it reports on after the machine passed the stop on', async () => {
        let stop: (() => void) | undefined;
        machine.answer('chat.stopTask', () => new Promise<never>((resolve) => (stop = () => resolve({} as never))));
        await open();
        await until(() => button('Stop workflow') !== null);
        await clickOn(button('Stop workflow'));
        await until(() => button('Stopping…') !== null);
        await clickOn(button('Stopping…'));
        expect(button('Stopping…')!.disabled).toBe(true);
        expect(machine.requests('chat.stopTask')).toEqual([{ chatId, taskId: 'task-wf' }]);

        // The machine passed the stop on; the workflow has not reported since.
        await act(async () => stop?.());
        expect(button('Stopping…')!.disabled).toBe(true);

        await emit(workflowCall('running', { ...WORKFLOW, lastProgressAt: 9000 }), 2);
        await until(() => button('Stop workflow') !== null);
        expect(button('Stop workflow')!.disabled).toBe(false);
    });

    test('offers no stop while the machine is away, and again once it is back', async () => {
        await open();
        await until(() => button('Stop workflow') !== null);
        await act(async () => machine.drop());
        await until(() => page.host.querySelector('[data-workflow-stale]') !== null);
        expect(button('Stop workflow')!.disabled).toBe(true);
        expect(cards().length).toBe(3);

        await act(async () => machine.reopen());
        await until(() => page.host.querySelector('[data-workflow-stale]') === null);
        expect(button('Stop workflow')!.disabled).toBe(false);
    });

    test('once it ended it says how it went, and goes with Close or with the next message', async () => {
        const ended = { ...WORKFLOW, finishedAt: 500 + 258_000, agents: WORKFLOW.agents.map((agent) => ({ ...agent, status: 'done' as const })) };
        await open();
        await until(() => card('Verify') !== undefined);
        await emit(workflowCall('done', ended), 2);
        await until(() => page.host.textContent?.includes('Done · 4m') === true);
        expect(button('Stop workflow')).toBeNull();
        // The phase that was open by itself closes with it.
        expect(card('Verify')!.querySelector('[data-workflow-agent="1"]')).toBeNull();

        await emit({ ...USER, id: 'user-2', createdAt: 900_000 }, 3);
        await until(() => cards().length === 0);
        expect(machine.requests('project.save')).toEqual([]);
    });

    test('a person puts a finished one away with Close', async () => {
        items = [USER, workflowCall('done', { ...WORKFLOW, finishedAt: 600 })];
        await open();
        await until(() => button('Close') !== null);
        await act(async () => focusedCanvas().getState().focusCard(derivedCardId(chatId, 'summary')));
        await clickOn(button('Close'));
        await until(() => cards().length === 0);
        // The keys go back to the node the cards stood beside.
        expect(focusedCanvas().getState().navigationId).toBe(chatId);
        expect(machine.requests('project.save')).toEqual([]);
    });

    test("on a machine this client does not know draws nothing, and never the workspace machine's chat", async () => {
        await open(chatNode({ machine: 'machine-unknown' } as Partial<ProjectNode>), [otherNode()]);
        await until(() => page.host.querySelector(`[data-node-id="${chatId}"]`) !== null);
        await until(() => cards(otherId).length > 0);
        expect(cards()).toEqual([]);
        expect(machine.requests('chat.attach').filter((request) => request.chatId === chatId)).toEqual([]);
    });
});

describe('the workflow pill over the composer', () => {
    const PILL = 'Review the branch · 1/3';

    function pill(): HTMLButtonElement | undefined {
        return [...page.host.querySelectorAll<HTMLButtonElement>('.chat-composer-content button')].find((candidate) => candidate.textContent?.includes(PILL));
    }

    test("in a chat view names the workflow, opens its phases, and an agent's conversation from there", async () => {
        workspace = await openFakeWorkspace(machine, { views: [{ kind: 'chat', id: chatId, name: 'Lead', node: { provider: 'claude' } }] } as never, {
            activeViewId: chatId,
            views: {}
        });
        page = mount();
        await page.renderApp();
        await until(() => pill() !== undefined);
        await clickOn(pill()!);
        await until(() => document.body.querySelector('[data-workflow-agent="1"]') !== null);
        expect(document.body.textContent).toContain('Verify');
        await clickOn(document.body.querySelector('[data-workflow-agent="1"]'));
        await until(() => machine.requests('chat.subagent').length > 0);
    });

    test('is not drawn on a chat node, whose workflow stands beside it', async () => {
        await open();
        await until(() => cards().length > 0);
        expect(page.host.querySelector('.chat-composer-content')).not.toBeNull();
        expect(pill()).toBeUndefined();
    });
});
