import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { appendFile, cp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FakeWatch } from '@adecore/agents/testing';
import type { ChatInfo, ChatItem, ChatSubagentItem } from '@ruimte/contracts';
import { makeChatFixture, retire, FIXTURE } from './chat-manager.fixture.test.ts';
import { ChatManager } from './chat-manager.ts';

const SESSION = '5f1c2a9e-0b7d-4c1e-9a53-3e2f8d6b7a10';

function subagentRow(toolUseId: string, overrides: Partial<ChatSubagentItem> = {}): ChatSubagentItem {
    return {
        id: `1:${toolUseId}`,
        kind: 'subagent',
        createdAt: 1,
        turnId: null,
        toolUseId,
        description: 'Review the branch',
        subagentType: 'general-purpose',
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
        ...overrides
    };
}

type ChatFixture = Awaited<ReturnType<typeof makeChatFixture>>;
let home: ChatFixture['home'];
let store: ChatFixture['store'];
let claude: ChatFixture['claude'];
let manager: ChatFixture['manager'];
let recorder: ChatFixture['recorder'];
let remake: ChatFixture['remake'];
let open: ChatFixture['open'];
let subagentWork: ChatFixture['subagentWork'];
beforeEach(async () => {
    ({ home, store, claude, manager, recorder, open, remake, subagentWork } = await makeChatFixture());
});
afterEach(async () => {
    await retire(manager);
    await rm(home, { recursive: true, force: true });
});

test('an agent a background subagent opened hangs under it, and the turn it wakes is about its parent', async () => {
    await open(manager, 'chat-nested');
    await manager.send('chat-nested', 'nested: the chain is done');
    await recorder.untilIdle();

    claude.started[0]!.runLater();
    await recorder.until(() => recorder.ofKind('turn').length === 2 && recorder.idle);
    const [middle, leaf] = recorder.ofKind('subagent');
    expect(middle).toMatchObject({ toolUseId: 'toolu_middle', status: 'done', background: true, result: 'the leaf said PONG' });
    expect(middle).not.toHaveProperty('parentToolUseId');
    expect(leaf).toMatchObject({ toolUseId: 'toolu_leaf', parentToolUseId: 'toolu_middle', status: 'done', result: 'PONG', turnId: middle!.turnId });
    // No tool row for the grandchild's call, beside the row that already stands for it.
    expect(recorder.ofKind('tool')).toEqual([]);
    expect(recorder.ofKind('turn')[1]).toMatchObject({ origin: 'agent', label: 'the chain is done', taskToolUseId: 'toolu_middle' });
});

test("a workflow's row carries its phases and agents from the progress reports, and settles with its task", async () => {
    await open(manager, 'chat-wf');
    await manager.send('chat-wf', 'workflow: Write a file, then read it');
    await recorder.untilIdle();
    const phases = [
        { index: 1, title: 'Write' },
        { index: 2, title: 'Read' }
    ];
    expect(recorder.ofKind('tool')[0]).toMatchObject({
        name: 'Workflow',
        state: 'running',
        workflow: { name: 'write-and-read', phases, agents: [{ label: 'write-file', phaseIndex: 1, agentId: 'a-writer', status: 'running' }] }
    });

    claude.started[0]!.runLater();
    await recorder.until(() => recorder.ofKind('turn').length === 2 && recorder.idle);
    expect(recorder.ofKind('tool')[0]).toMatchObject({
        state: 'done',
        workflow: {
            name: 'write-and-read',
            phases,
            agents: [
                { label: 'write-file', status: 'done', durationMs: 5000, lastTool: 'Write' },
                { label: 'read-file', phaseIndex: 2, agentId: 'a-reader', status: 'done', startedAt: 6000, durationMs: 4000 }
            ]
        }
    });
});

test("a background agent's approval outlives the turn, and a person allowing it later lets the agent finish", async () => {
    await open(manager, 'chat-ask');
    await manager.send('chat-ask', 'background approval: ls');
    await recorder.until(() => recorder.ofKind('turn')[0]?.state === 'done');

    expect(recorder.items.get('approval-req-bg')).toMatchObject({ decision: 'pending', toolName: 'Bash', toolUseId: 'toolu_bgask_bash' });
    expect(recorder.info).toMatchObject({ status: 'needs-you', activeTurnId: null });

    manager.approve('chat-ask', 'req-bg', 'allow');
    expect(recorder.items.get('approval-req-bg')).toMatchObject({ decision: 'allow' });
    await recorder.until(() => recorder.ofKind('turn')[1]?.state === 'done' && recorder.idle);
    expect(recorder.ofKind('turn')[1]).toMatchObject({ origin: 'agent' });
    expect(recorder.ofKind('subagent')[0]).toMatchObject({ toolUseId: 'toolu_bgask', status: 'done' });
    expect(subagentWork().find((item) => item.kind === 'tool')).toMatchObject({ output: 'ran: ls', state: 'done' });
});

test("a message after a background agent asked between turns settles on the CLI's own result", async () => {
    await open(manager, 'chat-late-ask');
    await manager.send('chat-late-ask', 'background approval: ls\nlate');
    await recorder.until(() => recorder.ofKind('turn')[0]?.state === 'done' && recorder.idle);

    claude.started[0]!.runLater();
    await recorder.until(() => recorder.items.get('approval-req-bg') !== undefined);
    expect(recorder.ofKind('turn')).toHaveLength(1);
    expect(recorder.items.get('approval-req-bg')).toMatchObject({ decision: 'pending', toolUseId: 'toolu_bgask_bash' });
    expect(recorder.info).toMatchObject({ status: 'needs-you', activeTurnId: null });

    expect(await manager.send('chat-late-ask', 'hello')).toMatchObject({ queued: false });
    await recorder.until(() => recorder.ofKind('turn')[1]?.state === 'done');
    expect(recorder.ofKind('turn')).toHaveLength(2);
    expect(recorder.ofKind('turn')[1]).toMatchObject({ origin: 'user', state: 'done' });
    expect(recorder.items.get('approval-req-bg')).toMatchObject({ decision: 'pending' });
    expect(recorder.info).toMatchObject({ status: 'needs-you', activeTurnId: null });
});

test("stopping the turn cancels a background agent's approval and turns it down for the CLI", async () => {
    await open(manager, 'chat-stop-ask');
    await manager.send('chat-stop-ask', 'background approval: ls\nslow');
    await recorder.until(() => recorder.items.get('approval-req-bg') !== undefined);
    expect(recorder.info?.status).toBe('needs-you');

    manager.cancel('chat-stop-ask');
    await recorder.until(() => recorder.ofKind('turn')[0]?.state === 'aborted');
    expect(recorder.items.get('approval-req-bg')).toMatchObject({ decision: 'cancelled' });
    // The agent heard no, so it finishes instead of waiting on an answer nobody can give any more.
    await recorder.until(() => recorder.ofKind('turn')[1]?.state === 'done' && recorder.idle);
    expect(subagentWork().find((item) => item.kind === 'tool')).toMatchObject({ output: 'The user stopped the turn', state: 'error' });
});

test('a background subagent that settles opens a turn of the agent, with the summary as its label', async () => {
    await open(manager, 'chat-bg');
    await manager.send('chat-bg', 'background: report written');
    await recorder.untilIdle();
    expect(recorder.ofKind('turn')).toHaveLength(1);

    // Nothing is sent from here, since the CLI wakes the agent itself once the task settles.
    claude.started[0]!.runLater();
    claude.started[0]!.runLater();
    await recorder.until(() => recorder.ofKind('turn').length === 2);
    const agentTurn = recorder.ofKind('turn')[1]!;
    expect(agentTurn).toMatchObject({ origin: 'agent', label: 'report written' });
    expect(recorder.events.some((event) => event.type === 'item' && event.item.id === agentTurn.id && event.item.kind === 'turn')).toBe(true);
    expect(recorder.events.some((event) => event.type === 'info' && event.info.activeTurnId === agentTurn.id && event.info.status === 'running')).toBe(true);

    const settled = (): boolean => {
        const turn = recorder.items.get(agentTurn.id);
        return turn?.kind === 'turn' && turn.state === 'done';
    };
    await recorder.until(settled);
    expect(recorder.items.get(agentTurn.id)).toMatchObject({ state: 'done', endedAt: expect.any(Number) });
    expect(recorder.idle).toBe(true);
    // The person wrote one message; the second turn has none and carries the agent's own answer.
    expect(recorder.ofKind('user')).toHaveLength(1);
    const answers = recorder.ofKind('assistant').filter((item) => !item.parentToolUseId);
    expect(answers.map((item) => item.text)).toEqual(['I will report back', 'the subagent says: report written']);
    expect(answers[1]?.turnId).toBe(agentTurn.id);

    const subagent = recorder.ofKind('subagent')[0]!;
    expect(subagent).toMatchObject({
        toolUseId: 'toolu_agent',
        description: 'report written',
        subagentType: 'general-purpose',
        background: true,
        status: 'done',
        summary: 'report written',
        result: 'the subagent says: report written',
        usage: { totalTokens: 1500, toolUses: 2, durationMs: 250 }
    });
    expect(agentTurn.taskToolUseId).toBe('toolu_agent');
    const children = [...recorder.items.values()].filter((item) => item.kind === 'tool' && item.parentToolUseId === 'toolu_agent');
    expect(children.map((item) => (item.kind === 'tool' ? item.name : ''))).toEqual(['Read', 'Bash']);
    // A subagent's work belongs to the turn its row sits in, not to the turn that woke the agent.
    expect(children.every((item) => item.turnId === subagent.turnId)).toBe(true);
});

test('a foreground subagent settles from its own call, without the footer the CLI appends', async () => {
    await open(manager, 'chat-delegate');
    await manager.send('chat-delegate', 'delegate: read the readme');
    await recorder.untilIdle();

    const subagent = recorder.ofKind('subagent')[0]!;
    expect(subagent).toMatchObject({
        toolUseId: 'toolu_delegate',
        description: 'read the readme',
        subagentType: 'general-purpose',
        prompt: 'Do this: read the readme',
        background: false,
        status: 'done',
        result: '# Report\n\n- one\n- two',
        lastTool: 'Bash',
        usage: { totalTokens: 1500, toolUses: 2, durationMs: 250 },
        itemsTruncated: false
    });
    expect(recorder.ofKind('tool').filter((item) => item.parentToolUseId === 'toolu_delegate')).toHaveLength(2);
    // The delegation is a subagent row, so it is not a tool row as well.
    expect(recorder.ofKind('tool').some((item) => item.name === 'Agent')).toBe(false);
});

test('a subagent whose work arrives before the CLI says it started keeps that work on its own row', async () => {
    await open(manager, 'chat-early');
    await manager.send('chat-early', 'delegate late: read the readme');
    await recorder.untilIdle();

    expect(recorder.ofKind('subagent')).toHaveLength(1);
    expect(recorder.ofKind('subagent')[0]).toMatchObject({
        toolUseId: 'toolu_delegate',
        status: 'done',
        background: false,
        subagentType: 'general-purpose',
        lastTool: 'Bash',
        result: '# Report\n\n- one\n- two',
        native: { agentId: 'task-delegate' }
    });
    const work = subagentWork();
    expect(work.map((item) => [item.kind, item.parentToolUseId])).toEqual([
        ['tool', 'toolu_delegate'],
        ['tool', 'toolu_delegate'],
        ['assistant', 'toolu_delegate']
    ]);
    // Nothing of the subagent's reached the thread of the chat itself.
    expect(recorder.ofKind('tool').every((item) => item.parentToolUseId === 'toolu_delegate')).toBe(true);
    expect(
        recorder
            .ofKind('assistant')
            .filter((item) => !item.parentToolUseId)
            .map((item) => item.text)
    ).toEqual(['summarized']);
    expect(recorder.ofKind('turn')).toHaveLength(1);
});

test('a background subagent that works on after its turn ended writes on its own row and opens a turn only once it settles', async () => {
    await open(manager, 'chat-later');
    await manager.send('chat-later', 'background: report written');
    await recorder.untilIdle();
    const launched = recorder.ofKind('turn')[0]!;
    // The person goes on with the chat before the subagent is done.
    await manager.send('chat-later', 'next question');
    await recorder.until(() => recorder.idle && recorder.ofKind('turn').length === 2);

    claude.started[0]!.runLater();
    await recorder.until(() => recorder.ofKind('subagent')[0]?.result === 'the subagent says: report written');
    expect(recorder.ofKind('subagent')[0]).toMatchObject({ status: 'running', turnId: launched.id });
    const work = subagentWork();
    expect(work.map((item) => [item.kind, item.parentToolUseId, item.turnId])).toEqual([
        ['tool', 'toolu_agent', launched.id],
        ['tool', 'toolu_agent', launched.id],
        ['assistant', 'toolu_agent', launched.id]
    ]);
    expect(recorder.ofKind('turn')).toHaveLength(2);
    expect(recorder.idle).toBe(true);
    expect(
        recorder
            .ofKind('assistant')
            .filter((item) => !item.parentToolUseId)
            .map((item) => item.text)
    ).toEqual(['I will report back', 'echo: next question']);

    claude.started[0]!.runLater();
    await recorder.until(() => recorder.idle && recorder.ofKind('turn').length === 3);
    expect(recorder.ofKind('subagent')[0]).toMatchObject({ status: 'done', turnId: launched.id });
    expect(recorder.ofKind('turn')[2]).toMatchObject({ origin: 'agent', label: 'report written', taskToolUseId: 'toolu_agent' });
});

describe('the conversation of a Claude subagent', () => {
    test('is read beside the session with no CLI running, notes its agent on the row, and lets go with the socket', async () => {
        const watch = new FakeWatch();
        manager = await remake(manager, { subagents: { claudeProjectsDir: FIXTURE, seams: watch } });
        await open(manager, 'chat-sub', { cwd: '/work/demo', resume: SESSION });
        const session = manager.get('chat-sub')!;
        session.thread.upsert(subagentRow('toolu_01ParentAgentCall', { description: 'Survey the docs', background: false, status: 'done', finishedAt: 2 }));

        const page = await manager.subagent('c1', { chatId: 'chat-sub', toolUseId: 'toolu_01ParentAgentCall', watch: true });
        expect(page).toMatchObject({ source: 'claude-transcript', live: false });
        expect(page.items.at(-1)).toMatchObject({ kind: 'assistant' });
        expect(claude.started).toHaveLength(0);
        await recorder.until(() => recorder.ofKind('subagent')[0]?.native?.agentId === 'a4c2e8f10b3d5a7e9');

        const dir = join(FIXTURE, '-work-demo', SESSION, 'subagents');
        const watcher = watch.on(dir);
        watcher.emit('agent-a4c2e8f10b3d5a7e9.jsonl');
        const told: unknown[] = [];
        manager.subscribe('c1', (event) => told.push(event));
        await watch.settle();
        expect(told).toEqual([{ event: 'chat.subagentChanged', payload: { chatId: 'chat-sub', toolUseId: 'toolu_01ParentAgentCall' } }]);

        manager.detachAll('c1');
        expect(watcher.closed).toBe(true);
    });
});

describe('a background subagent whose CLI is gone', () => {
    const CALL = 'toolu_01ChildAgentCall';

    const runningRow = (toolUseId: string): ChatSubagentItem =>
        subagentRow(toolUseId, { turnId: 'turn-1', description: 'Count the headings', summary: 'Running grep', lastTool: 'Bash' });

    const storedInfo = (chatId: string, provider: ChatInfo['provider']): ChatInfo => ({
        chatId,
        provider,
        cwd: '/work/demo',
        agentSessionId: SESSION,
        model: null,
        selection: { model: 'claude-opus-5', options: {} },
        runtimeMode: 'full-access',
        status: 'idle',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { contextTokens: 0, contextWindow: 200_000, costUsd: 0, turns: 1 },
        createdAt: 1
    });

    const rowOf = (target: ChatManager, chatId: string, toolUseId: string): ChatItem | undefined =>
        target.get(chatId)?.thread.find('subagent', (item) => item.toolUseId === toolUseId);

    let projects: string;

    beforeEach(async () => {
        projects = join(home, 'claude-projects');
        await cp(FIXTURE, projects, { recursive: true });
    });

    test('settles as done on load when its transcript shows the end, which the next load keeps', async () => {
        await store.write('chat-stale', storedInfo('chat-stale', 'claude'), [runningRow(CALL)]);
        manager = await remake(manager, { subagents: { claudeProjectsDir: projects, seams: new FakeWatch() } });

        await manager.create({ chatId: 'chat-stale' });
        expect(rowOf(manager, 'chat-stale', CALL)).toMatchObject({
            status: 'done',
            finishedAt: Date.parse('2026-09-16T08:58:39.000Z'),
            result: 'There are 42 headings.'
        });
        await manager.shutdown();
        expect((await store.read('chat-stale'))?.items.find((item) => item.kind === 'subagent')).toMatchObject({ status: 'done' });
    });

    test('marks an unfinished transcript lost on load and recovers a later recorded end on read', async () => {
        const transcript = join(projects, '-work-demo', SESSION, 'subagents', 'agent-a9b8c7d6e5f4a3b21.jsonl');
        const finished = await readFile(transcript, 'utf8');
        const lines = finished.trimEnd().split('\n');
        const toolCall = JSON.stringify({
            isSidechain: true,
            type: 'assistant',
            timestamp: '2026-09-16T08:58:31.000Z',
            message: { id: 'msg_more', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_more', name: 'Bash', input: {} }], stop_reason: 'tool_use' }
        });
        await writeFile(transcript, `${[...lines, toolCall].join('\n')}\n`);
        await store.write('chat-working', storedInfo('chat-working', 'claude'), [runningRow(CALL)]);
        manager = await remake(manager, { subagents: { claudeProjectsDir: projects, seams: new FakeWatch() } });

        await manager.create({ chatId: 'chat-working' });
        expect(rowOf(manager, 'chat-working', CALL)).toMatchObject({ status: 'failed', finishedAt: expect.any(Number) });

        const answer = JSON.stringify({
            isSidechain: true,
            type: 'assistant',
            timestamp: '2026-09-16T08:59:00.000Z',
            message: { id: 'msg_last', role: 'assistant', content: [{ type: 'text', text: 'Still 42.' }], stop_reason: 'end_turn' }
        });
        await appendFile(transcript, `${answer}\n`);
        await manager.subagent('c1', { chatId: 'chat-working', toolUseId: CALL });
        expect(rowOf(manager, 'chat-working', CALL)).toMatchObject({ status: 'done', finishedAt: Date.parse('2026-09-16T08:59:00.000Z'), result: 'Still 42.' });
    });

    test('a Codex agent was running inside the app-server that went down, so a load settles it as failed', async () => {
        await store.write('chat-codex', storedInfo('chat-codex', 'codex'), [{ ...runningRow('collab_1'), native: { threadId: 'child-1' } }]);
        manager = await remake(manager, { subagents: { claudeProjectsDir: projects, seams: new FakeWatch() } });

        await manager.create({ chatId: 'chat-codex' });
        expect(rowOf(manager, 'chat-codex', 'collab_1')).toMatchObject({ status: 'failed', finishedAt: expect.any(Number) });
    });

    test.each(['end_turn', 'tool_use', null] as const)('a CLI that exits before its notification settles a transcript ending in %s', async (stopReason) => {
        const subagents = join(projects, '-work-demo', SESSION, 'subagents');
        await writeFile(join(subagents, 'agent-afake.meta.json'), JSON.stringify({ agentType: 'general-purpose', toolUseId: 'toolu_agent' }));
        await writeFile(join(subagents, 'agent-abarrier.meta.json'), JSON.stringify({ agentType: 'general-purpose', toolUseId: 'toolu_barrier' }));
        await writeFile(
            join(subagents, 'agent-abarrier.jsonl'),
            `${JSON.stringify({ type: 'assistant', timestamp: '2026-09-16T09:00:01.000Z', message: { id: 'barrier', role: 'assistant', content: [{ type: 'text', text: 'Finished reading.' }], stop_reason: 'end_turn' } })}\n`
        );
        if (stopReason !== null) {
            await writeFile(
                join(subagents, 'agent-afake.jsonl'),
                `${JSON.stringify({ type: 'assistant', timestamp: '2026-09-16T09:00:00.000Z', message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: 'All written.' }], stop_reason: stopReason } })}\n`
            );
        }
        manager = await remake(manager, { subagents: { claudeProjectsDir: projects, seams: new FakeWatch() } });
        await open(manager, 'chat-exit', { cwd: '/work/demo', resume: SESSION });
        await manager.send('chat-exit', 'background: report written');
        await recorder.untilIdle();
        expect(rowOf(manager, 'chat-exit', 'toolu_agent')).toMatchObject({ status: 'running' });
        manager.get('chat-exit')!.thread.upsert(runningRow('toolu_barrier'));

        // The CLI goes before the work it put off ever runs, so no notification comes.
        void manager.send('chat-exit', 'crash').catch(() => undefined);
        await claude.started[0]!.exited;
        // The completed sibling is published after all transcript lookups, including an unfinished or missing one.
        await recorder.until(() => recorder.ofKind('subagent').some((row) => row.toolUseId === 'toolu_barrier' && row.status === 'done'));
        expect(rowOf(manager, 'chat-exit', 'toolu_agent')).toMatchObject(
            stopReason === 'end_turn'
                ? { status: 'done', result: 'All written.', finishedAt: Date.parse('2026-09-16T09:00:00.000Z') }
                : { status: 'failed', finishedAt: expect.any(Number) }
        );
    });
});

describe("stopping a subagent of the CLI's own", () => {
    test('is refused while the turn that may wait on it runs, and marks the row stopped with a note once none runs', async () => {
        await open(manager, 'chat-stop');
        const session = manager.get('chat-stop')!;
        session.thread.upsert(subagentRow('toolu_bg'));

        void manager.send('chat-stop', 'slow');
        await recorder.until(() => recorder.info?.activeTurnId !== null);
        await expect(manager.stopSubagent('chat-stop', 'toolu_bg')).rejects.toMatchObject({ code: 'chat-busy' });
        manager.cancel('chat-stop');
        await recorder.until(() => recorder.info?.activeTurnId === null);

        await manager.stopSubagent('chat-stop', 'toolu_bg');
        expect(recorder.items.get('1:toolu_bg')).toMatchObject({ status: 'failed', finishedAt: expect.any(Number) });
        expect(recorder.ofKind('note').map((note) => note.text)).toContain(
            '"Review the branch" was marked as stopped. Claude Code cannot stop one sub-agent on its own, so it may keep working until the chat\'s process ends.'
        );
        await manager.stopSubagent('chat-stop', 'toolu_bg');
        await expect(manager.stopSubagent('chat-stop', 'toolu_none')).rejects.toMatchObject({ code: 'subagent-not-found' });
    });
});
