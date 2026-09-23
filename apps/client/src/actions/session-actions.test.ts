import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ActionRegistry, type ActionResult } from '@ruimte/actions';
import type { ChatForkResult, ChatInfo, ChatItem, Plan, PlanPersonOp, ProviderInfo, RequestMap, RequestType } from '@ruimte/contracts';
import { applyPlanOps } from '@ruimte/plan';
import { createClientActionRegistry, PERSON_ACTION_CALL, VOICE_ACTION_CALL } from './client-actions';
import { sessionActions, type SessionMachine } from './session-actions';
import type { ChatState } from '@/state/chats';
import { useDocument } from '@/state/document';
import type { SessionState } from '@/state/sessions';
import { TransportError, type Transport } from '@/transport/transport';

type Answers = { [Type in RequestType]?: (payload: RequestMap[Type]['payload']) => RequestMap[Type]['result'] | Promise<RequestMap[Type]['result']> };

const info = (patch: Partial<ChatInfo> = {}): ChatInfo => ({
    chatId: 'chat',
    provider: 'claude',
    cwd: '/work',
    agentSessionId: 'session-1',
    model: null,
    selection: { model: 'sonnet', options: { effort: 'medium' } },
    runtimeMode: 'supervised',
    status: 'running',
    running: true,
    activeTurnId: 'turn-2',
    slashCommands: [],
    usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 2 },
    createdAt: 0,
    ...patch
});

const question: ChatItem = {
    id: 'q-item',
    kind: 'question',
    createdAt: 5,
    turnId: 'turn-2',
    requestId: 'ask-1',
    questions: [
        { id: 'db', header: 'Database', question: 'Which database?', choices: [{ label: 'Postgres', description: '' }], multiSelect: false },
        { id: 'name', header: 'Name', question: 'What is the table called?', choices: [], multiSelect: false }
    ],
    answers: null,
    state: 'pending'
};

const thread: ChatItem[] = [
    { id: 'turn-1', kind: 'turn', createdAt: 0, turnId: 'turn-1', state: 'done', endedAt: 1, costUsd: 0 },
    { id: 'turn-2', kind: 'turn', createdAt: 2, turnId: 'turn-2', state: 'running', endedAt: null, costUsd: 0 },
    question,
    {
        id: 'optional',
        kind: 'question',
        createdAt: 6,
        turnId: 'turn-2',
        requestId: 'ask-2',
        questions: [question.questions[0]!],
        answers: null,
        state: 'pending',
        async: true
    },
    {
        id: 'approval',
        kind: 'approval',
        createdAt: 7,
        turnId: 'turn-2',
        requestId: 'perm-1',
        toolUseId: null,
        toolName: 'Bash',
        input: {},
        description: 'rm -rf build',
        canAllowAlways: false,
        decision: 'pending'
    },
    {
        id: 'task-t1',
        kind: 'subagent',
        createdAt: 8,
        turnId: 'turn-2',
        toolUseId: 'use-task',
        description: 'Write the migration',
        subagentType: null,
        prompt: null,
        background: true,
        status: 'running',
        startedAt: 8,
        finishedAt: null,
        summary: null,
        result: null,
        usage: null,
        lastTool: null,
        itemsTruncated: false,
        origin: 'ruimte',
        childId: 'child-1'
    },
    {
        id: 'own',
        kind: 'subagent',
        createdAt: 9,
        turnId: 'turn-2',
        toolUseId: 'use-own',
        description: 'Explore the schema',
        subagentType: null,
        prompt: null,
        background: false,
        status: 'running',
        startedAt: 9,
        finishedAt: null,
        summary: null,
        result: null,
        usage: null,
        lastTool: null,
        itemsTruncated: false
    }
];

const rowOf = (chatInfo: ChatInfo, items: ChatItem[] = thread): ChatState => {
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    return { info: chatInfo, items: byId, structure: byId, order: items.map((item) => item.id) };
};

const plan = (): Plan => ({
    id: 'p1',
    rev: 1,
    createdAt: '2026-09-23T10:00:00Z',
    meta: { title: 'Ship', kind: 'steps', checks: 'anyone' },
    items: [
        { type: 'step', id: 'write', title: 'Write the code' },
        { type: 'step', id: 'look', title: 'Look at it in the app', checks: 'person' },
        { type: 'step', id: 'locked', title: 'Run the suite', checks: 'agent' }
    ]
});

const claude = {
    kind: 'claude',
    name: 'Claude Code',
    installed: true,
    capabilities: { chat: true, terminal: true },
    models: [
        {
            slug: 'sonnet',
            name: 'Sonnet',
            legacy: false,
            isDefault: true,
            options: [
                {
                    id: 'effort',
                    label: 'Effort',
                    type: 'select',
                    choices: [
                        { id: 'medium', label: 'Medium' },
                        { id: 'high', label: 'High' }
                    ],
                    defaultChoice: 'medium'
                }
            ]
        },
        { slug: 'opus', name: 'Opus', legacy: false, isDefault: false, options: [] }
    ]
} as unknown as ProviderInfo;
const codex = {
    ...claude,
    kind: 'codex',
    name: 'Codex',
    models: [{ slug: 'gpt', name: 'GPT', legacy: false, isDefault: true, options: [] }]
} as unknown as ProviderInfo;

interface Fake {
    registry: ActionRegistry<void>;
    of(type: RequestType): Record<string, unknown>[];
    applied: { chatId: string; planId: string; ops: PlanPersonOp[] }[];
    retargeted: string[];
    revealed: ChatForkResult[];
}

const fake = (answers: Answers = {}, machine: Partial<SessionMachine> = {}): Fake => {
    const asked: { type: RequestType; payload: Record<string, unknown> }[] = [];
    const applied: Fake['applied'] = [];
    const retargeted: string[] = [];
    const revealed: ChatForkResult[] = [];
    const defaults: Answers = {
        'agent.children': () => ({ nodeIds: ['child-1', 'child-2'] }),
        'chat.cancel': () => ({}),
        'chat.answer': () => ({}),
        'chat.dismiss': () => ({}),
        'chat.approve': () => ({}),
        'chat.unqueue': () => ({}),
        'chat.sendNow': () => ({}),
        'chat.stopSubagent': () => ({}),
        'chat.stopTask': () => ({}),
        'session.kill': () => ({}),
        'agent.resume': () => ({}),
        'agent.answerApproval': () => ({ accepted: true }),
        'chat.configure': (payload) => info({ selection: payload.selection ?? info().selection, runtimeMode: payload.runtimeMode ?? 'supervised' }),
        'chat.fork': (payload) => ({
            info: info({ chatId: 'fork-1' }),
            nodeId: 'fork-1',
            viewId: 'main',
            edgeId: null,
            ...(payload.worktree ? { worktree: { path: '/wt', branch: payload.worktree.branch ?? 'x', from: { branch: 'main', commit: 'abc' } } } : {})
        }),
        'chat.subagent': () => ({
            items: [
                { id: 's1', kind: 'user', createdAt: 1, turnId: null, text: 'Look at the schema' },
                { id: 's2', kind: 'assistant', createdAt: 2, turnId: null, text: 'It has three tables.', parentToolUseId: 'use-own' }
            ] as ChatItem[],
            history: { cursor: null },
            source: 'claude-transcript',
            live: true
        })
    };
    const transport = {
        request: (async (type: RequestType, payload: Record<string, unknown>) => {
            asked.push({ type, payload });
            const answer = (answers[type] ?? defaults[type]) as ((payload: unknown) => unknown) | undefined;
            if (!answer) {
                throw new Error(`No answer for ${type}`);
            }
            return answer(payload);
        }) as unknown as Transport['request']
    };
    let current = plan();
    const registry = new ActionRegistry<void>(
        sessionActions(useDocument, {
            transport: () => transport,
            chat: (chatId) => (chatId === 'chat' ? rowOf(info()) : null),
            isOpen: () => true,
            applyInfo: () => undefined,
            terminal: () => ({ attached: true }) as SessionState,
            screen: () => ['$ bun test', ...Array.from({ length: 60 }, (_, i) => `line ${i}`)],
            providers: () => [claude, codex],
            providerFixed: () => false,
            retarget: async (chatId, provider) => {
                retargeted.push(`${chatId}:${provider}`);
                return true;
            },
            plans: () => [current],
            applyPlan: async (chatId, planId, ops) => {
                applied.push({ chatId, planId, ops });
                const result = applyPlanOps(current, ops, { actor: 'person', now: '2026-09-23T12:00:00Z' });
                if (!result.ok) {
                    throw new Error(result.message);
                }
                current = result.plan;
                return current;
            },
            revealFork: (result) => void revealed.push(result),
            ...machine
        })
    );
    return { registry, of: (type) => asked.filter((entry) => entry.type === type).map((entry) => entry.payload), applied, retargeted, revealed };
};

const confirm = async (registry: ActionRegistry<void>, asked: ActionResult): Promise<ActionResult> => {
    if (asked.status !== 'needs_confirmation') {
        throw new Error(`Expected a confirmation, got ${JSON.stringify(asked)}`);
    }
    return registry.confirm(asked.confirmationToken, true, VOICE_ACTION_CALL);
};

const consequences = (result: ActionResult): string =>
    result.status === 'needs_confirmation' ? `${result.confirmation.title} ${result.confirmation.consequences.join(' ')}` : '';

beforeEach(() => {
    useDocument.getState().load(
        {
            version: 3,
            rev: 1,
            name: 'Atlas',
            color: '#000',
            views: [
                { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] },
                { kind: 'chat', id: 'chat', name: 'Research', node: {} },
                { kind: 'chat', id: 'fresh', name: 'Fresh', node: {} },
                { kind: 'terminal', id: 'term', name: 'Build', node: {} }
            ]
        },
        { activeViewId: 'main', views: {} }
    );
});

afterEach(() => {
    useDocument.getState().load(null, null);
});

describe('stopping', () => {
    test('Voice asks before it stops a turn, names what else ends, and a person stops at once', async () => {
        const { registry, of } = fake();
        const asked = await registry.execute('chat.stopTurn', { chatId: 'chat', subagents: true }, VOICE_ACTION_CALL);
        expect(consequences(asked)).toContain('Stop the turn of “Research”?');
        expect(consequences(asked)).toContain('ends unfinished');
        expect(consequences(asked)).toContain('The 2 agents it opened end as well');
        expect(of('chat.cancel')).toEqual([]);
        expect(await confirm(registry, asked)).toMatchObject({ status: 'completed', output: { chat: 'Research', subagents: true } });
        expect(of('chat.cancel')).toEqual([{ chatId: 'chat', subagents: true }]);

        expect(await registry.execute('chat.stopTurn', { chatId: 'chat', subagents: false }, PERSON_ACTION_CALL)).toMatchObject({ status: 'completed' });
        expect(of('chat.cancel').at(-1)).toEqual({ chatId: 'chat' });
    });

    test('Voice cannot stop a turn that is not running', async () => {
        const { registry } = fake({}, { chat: () => rowOf(info({ activeTurnId: null })) });
        expect(await registry.execute('chat.stopTurn', { chatId: 'chat', subagents: false }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'not-working' }
        });
    });

    test('a sub-agent opened with a task says its task is cancelled; one that belongs to the running turn is refused', async () => {
        const { registry, of } = fake();
        const asked = await registry.execute('chat.stopSubagent', { chatId: 'chat', toolUseId: 'use-task' }, VOICE_ACTION_CALL);
        expect(consequences(asked)).toContain('Stop “Write the migration”?');
        expect(consequences(asked)).toContain('the task is cancelled');
        await confirm(registry, asked);
        expect(of('chat.stopSubagent')).toEqual([{ chatId: 'chat', toolUseId: 'use-task' }]);
        expect(await registry.execute('chat.stopSubagent', { chatId: 'chat', toolUseId: 'use-own' }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'not-stoppable' }
        });
    });

    test('a background task Voice stops is named, and one the chat does not run is refused', async () => {
        const { registry, of } = fake(
            {},
            {
                chat: () =>
                    rowOf(info({ background: [{ id: 'bg-1', kind: 'shell', description: 'Watch the tests', command: 'bun test --watch', startedAt: 1 }] }))
            }
        );
        const asked = await registry.execute('chat.stopTask', { chatId: 'chat', taskId: 'bg-1' }, VOICE_ACTION_CALL);
        expect(consequences(asked)).toContain('background command “Watch the tests”');
        await confirm(registry, asked);
        expect(of('chat.stopTask')).toEqual([{ chatId: 'chat', taskId: 'bg-1' }]);
        expect(await registry.execute('chat.stopTask', { chatId: 'chat', taskId: 'bg-9' }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'unknown-task' }
        });
    });

    test('Voice asks before it ends a terminal session and says what is lost', async () => {
        const { registry, of } = fake();
        const asked = await registry.execute('terminal.stop', { terminalId: 'term' }, VOICE_ACTION_CALL);
        expect(consequences(asked)).toContain('Stop the session of “Build”?');
        expect(consequences(asked)).toContain('scrollback');
        await confirm(registry, asked);
        expect(of('session.kill')).toEqual([{ sessionId: 'term' }]);

        const ended = fake({}, { terminal: () => ({ attached: true, exited: 0 }) as SessionState });
        expect(await ended.registry.execute('terminal.stop', { terminalId: 'term' }, VOICE_ACTION_CALL)).toMatchObject({ error: { code: 'not-running' } });
    });
});

describe('starting a terminal over', () => {
    const ended = (agent?: SessionState['agent']): Partial<SessionMachine> & { restarts: { terminalId: string; resume: string | null }[] } => {
        const restarts: { terminalId: string; resume: string | null }[] = [];
        return {
            restarts,
            terminal: () => ({ attached: true, exited: 0, ...(agent === undefined ? {} : { agent }) }) as SessionState,
            terminalHost: () => ({ provider: 'claude', runtimeMode: 'auto-accept-edits' }),
            restartTerminal: async (terminalId, resume) => {
                restarts.push({ terminalId, resume });
            }
        };
    };
    const exitedAgent = { kind: 'claude', agentSessionId: 'cli-session-7', status: 'exited', live: false } as unknown as SessionState['agent'];

    test('a person restarts an ended shell at once, and Voice first says which CLI starts again', async () => {
        const machine = ended();
        const { registry } = fake({}, machine);
        expect(await registry.execute('terminal.restart', { terminalId: 'term' }, PERSON_ACTION_CALL)).toMatchObject({
            status: 'completed',
            output: { terminalId: 'term', terminal: 'Build' }
        });
        expect(machine.restarts).toEqual([{ terminalId: 'term', resume: null }]);

        const asked = await registry.execute('terminal.restart', { terminalId: 'term' }, VOICE_ACTION_CALL);
        expect(consequences(asked)).toContain('Restart “Build”?');
        expect(consequences(asked)).toContain('Claude Code starts again on a new session, in auto-accept-edits mode.');
        expect(machine.restarts).toHaveLength(1);
        await confirm(registry, asked);
        expect(machine.restarts).toHaveLength(2);
    });

    test('a shell that still runs, or one this window never drew, is not restarted', async () => {
        const { registry } = fake();
        expect(await registry.execute('terminal.restart', { terminalId: 'term' }, PERSON_ACTION_CALL)).toMatchObject({ error: { code: 'still-running' } });
        const unseen = fake({}, { terminal: () => null });
        expect(await unseen.registry.execute('terminal.restart', { terminalId: 'term' }, PERSON_ACTION_CALL)).toMatchObject({
            error: { code: 'terminal-not-open' }
        });
    });

    test('resume goes on in the running shell, and in a fresh one with the session of the CLI that went down with it', async () => {
        const running = fake();
        expect(await running.registry.execute('terminal.resumeAgent', { terminalId: 'term' }, VOICE_ACTION_CALL)).toMatchObject({ status: 'completed' });
        expect(running.of('agent.resume')).toEqual([{ sessionId: 'term' }]);

        const machine = ended(exitedAgent);
        const { registry, of } = fake({}, machine);
        expect(await registry.execute('terminal.resumeAgent', { terminalId: 'term' }, PERSON_ACTION_CALL)).toMatchObject({ status: 'completed' });
        expect(machine.restarts).toEqual([{ terminalId: 'term', resume: 'cli-session-7' }]);
        expect(of('agent.resume')).toEqual([]);

        const nothing = fake({}, ended());
        expect(await nothing.registry.execute('terminal.resumeAgent', { terminalId: 'term' }, PERSON_ACTION_CALL)).toMatchObject({
            error: { code: 'nothing-to-resume' }
        });
    });
});

describe('answering', () => {
    test('Voice repeats every answer in the confirmation before it is sent', async () => {
        const { registry, of } = fake();
        const answers = [
            { questionId: 'db', answer: 'Postgres' },
            { questionId: 'name', answer: 'orders' }
        ];
        const asked = await registry.execute('chat.answer', { chatId: 'chat', requestId: 'ask-1', answers }, VOICE_ACTION_CALL);
        expect(consequences(asked)).toContain('Which database? Answer: “Postgres”.');
        expect(consequences(asked)).toContain('What is the table called? Answer: “orders”.');
        expect(of('chat.answer')).toEqual([]);
        await confirm(registry, asked);
        expect(of('chat.answer')).toEqual([{ chatId: 'chat', requestId: 'ask-1', answers: { db: 'Postgres', name: 'orders' } }]);
    });

    test('Voice cannot leave a part unanswered, answer a part that does not exist or answer a chat nobody has open', async () => {
        const { registry } = fake();
        expect(
            await registry.execute(
                'chat.answer',
                { chatId: 'chat', requestId: 'ask-1', answers: [{ questionId: 'db', answer: 'Postgres' }] },
                VOICE_ACTION_CALL
            )
        ).toMatchObject({ error: { code: 'unanswered' } });
        expect(
            await registry.execute('chat.answer', { chatId: 'chat', requestId: 'ask-1', answers: [{ questionId: 'color', answer: 'Blue' }] }, VOICE_ACTION_CALL)
        ).toMatchObject({ error: { code: 'unknown-question' } });
        const closed = fake({}, { isOpen: () => false });
        expect(
            await closed.registry.execute(
                'chat.answer',
                { chatId: 'chat', requestId: 'ask-1', answers: [{ questionId: 'db', answer: 'Postgres' }] },
                VOICE_ACTION_CALL
            )
        ).toMatchObject({ error: { code: 'chat-not-open' } });
    });

    test("a person's card sends at once", async () => {
        const { registry, of } = fake();
        expect(
            await registry.execute(
                'chat.answer',
                { chatId: 'chat', requestId: 'ask-1', answers: [{ questionId: 'db', answer: 'Postgres' }] },
                PERSON_ACTION_CALL
            )
        ).toMatchObject({ status: 'completed' });
        expect(of('chat.answer')).toEqual([{ chatId: 'chat', requestId: 'ask-1', answers: { db: 'Postgres' } }]);
    });

    test('only an optional question may be dismissed', async () => {
        const { registry, of } = fake();
        expect(await registry.execute('chat.dismissQuestion', { chatId: 'chat', itemId: 'q-item' }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'not-optional' }
        });
        await confirm(registry, await registry.execute('chat.dismissQuestion', { chatId: 'chat', itemId: 'optional' }, VOICE_ACTION_CALL));
        expect(of('chat.dismiss')).toEqual([{ chatId: 'chat', itemId: 'optional' }]);
    });

    test('an approval is the person’s alone, in a chat and in a terminal', async () => {
        const { registry, of } = fake();
        expect(
            await registry.execute('chat.approve', { chatId: 'chat', requestId: 'perm-1', decision: 'allow', message: null }, VOICE_ACTION_CALL)
        ).toMatchObject({ error: { code: 'forbidden-action' } });
        expect(await registry.execute('terminal.answerApproval', { terminalId: 'term', requestId: 'r', choiceId: 'yes' }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'forbidden-action' }
        });
        expect(of('chat.approve')).toEqual([]);
        await registry.execute('chat.approve', { chatId: 'chat', requestId: 'perm-1', decision: 'deny', message: 'too broad' }, PERSON_ACTION_CALL);
        expect(of('chat.approve')).toEqual([{ chatId: 'chat', requestId: 'perm-1', decision: 'deny', message: 'too broad' }]);
        expect(await registry.execute('terminal.answerApproval', { terminalId: 'term', requestId: 'r', choiceId: 'yes' }, PERSON_ACTION_CALL)).toMatchObject({
            output: { accepted: true }
        });
        const settled = fake({ 'agent.answerApproval': () => Promise.reject(new TransportError('gone', 'settled')) });
        expect(
            await settled.registry.execute('terminal.answerApproval', { terminalId: 'term', requestId: 'r', choiceId: 'yes' }, PERSON_ACTION_CALL)
        ).toMatchObject({ output: { accepted: false } });
    });
});

describe('reading', () => {
    test('a chat says what waits in it, approvals included, so Voice can tell the user', async () => {
        const { registry } = fake({}, { chat: () => rowOf(info({ queue: [{ id: 'm1', text: 'And the docs', createdAt: 3 }] })) });
        const result = await registry.execute('chat.inspect', { chatId: 'chat' }, VOICE_ACTION_CALL);
        expect(result).toMatchObject({
            status: 'completed',
            output: {
                chat: 'Research',
                model: 'sonnet',
                working: true,
                open: true,
                queue: [{ messageId: 'm1', text: 'And the docs' }],
                questions: [
                    { requestId: 'ask-1', itemId: 'q-item', optional: false },
                    { requestId: 'ask-2', itemId: 'optional', optional: true }
                ],
                approvals: [{ requestId: 'perm-1', tool: 'Bash', description: 'rm -rf build' }],
                subagents: [
                    { toolUseId: 'use-task', stoppable: true },
                    { toolUseId: 'use-own', stoppable: false }
                ],
                lastTurnId: 'turn-1'
            }
        });
        const closed = fake({}, { isOpen: () => false });
        expect(await closed.registry.execute('chat.inspect', { chatId: 'chat' }, VOICE_ACTION_CALL)).toMatchObject({
            output: { open: false, questions: [], approvals: [], lastTurnId: null }
        });
    });

    test('a terminal reads its last lines, and one this window never drew is refused', async () => {
        const { registry } = fake();
        const result = await registry.execute('terminal.read', { terminalId: 'term', lines: 3 }, VOICE_ACTION_CALL);
        expect(result).toMatchObject({ output: { terminal: 'Build', lines: ['line 57', 'line 58', 'line 59'], truncated: true, exited: false } });
        const unseen = fake({}, { screen: () => null });
        expect(await unseen.registry.execute('terminal.read', { terminalId: 'term', lines: null }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'terminal-not-open' }
        });
    });

    test('a sub-agent reads as its own conversation and leaves the watch of whoever has it open alone', async () => {
        const { registry, of } = fake();
        const result = await registry.execute('chat.readSubagent', { chatId: 'chat', toolUseId: 'use-own', limit: null }, VOICE_ACTION_CALL);
        expect(result).toMatchObject({ output: { live: true, messages: [{ role: 'user' }, { role: 'assistant', text: 'It has three tables.' }] } });
        expect(of('chat.subagent')).toEqual([{ chatId: 'chat', toolUseId: 'use-own', limit: 100 }]);
    });
});

describe('queued messages and configuration', () => {
    test('Voice takes back only a message that waits, and sends one now', async () => {
        const { registry, of } = fake({}, { chat: () => rowOf(info({ queue: [{ id: 'm1', text: 'And the docs', createdAt: 3 }] })) });
        expect(await registry.execute('chat.unqueue', { chatId: 'chat', messageId: 'm1' }, VOICE_ACTION_CALL)).toMatchObject({
            output: { text: 'And the docs' }
        });
        expect(await registry.execute('chat.sendNow', { chatId: 'chat', messageId: 'm2' }, VOICE_ACTION_CALL)).toMatchObject({ error: { code: 'not-queued' } });
        expect(of('chat.unqueue')).toEqual([{ chatId: 'chat', messageId: 'm1' }]);
        expect(of('chat.sendNow')).toEqual([]);
    });

    test('Voice changes the model and one option by the ids the provider lists, never the permission mode', async () => {
        const { registry, of } = fake();
        expect(
            await registry.execute('chat.configure', { chatId: 'chat', model: null, option: { id: 'effort', value: 'high' } }, VOICE_ACTION_CALL)
        ).toMatchObject({ output: { model: 'sonnet', options: { effort: 'high' } } });
        expect(of('chat.configure')).toEqual([{ chatId: 'chat', selection: { model: 'sonnet', options: { effort: 'high' } } }]);
        expect(await registry.execute('chat.configure', { chatId: 'chat', model: 'haiku', option: null }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'unknown-model' }
        });
        expect(
            await registry.execute('chat.configure', { chatId: 'chat', model: null, option: { id: 'effort', value: 'extreme' } }, VOICE_ACTION_CALL)
        ).toMatchObject({ error: { code: 'unknown-choice' } });
        expect(
            await registry.execute('chat.configure', { chatId: 'chat', model: null, option: null, runtimeMode: 'full-access' }, VOICE_ACTION_CALL)
        ).toMatchObject({ error: { code: 'forbidden-field' } });
        await registry.execute('chat.configure', { chatId: 'chat', model: null, option: null, runtimeMode: 'auto' }, PERSON_ACTION_CALL);
        expect(of('chat.configure').at(-1)).toEqual({ chatId: 'chat', runtimeMode: 'auto' });
    });

    test('a chat that started keeps its CLI; a fresh one switches', async () => {
        const { registry, retargeted } = fake(
            {},
            {
                chat: (chatId) =>
                    chatId === 'fresh' ? rowOf(info({ chatId: 'fresh', agentSessionId: null, usage: { ...info().usage, turns: 0 } }), []) : rowOf(info())
            }
        );
        expect(await registry.execute('chat.setProvider', { chatId: 'chat', provider: 'codex', model: null }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'provider-fixed' }
        });
        expect(await registry.execute('chat.setProvider', { chatId: 'fresh', provider: 'codex', model: null }, VOICE_ACTION_CALL)).toMatchObject({
            status: 'completed',
            output: { provider: 'codex' }
        });
        expect(retargeted).toEqual(['fresh:codex']);
    });
});

describe('forking', () => {
    test('Voice forks after the last finished turn, and asks first when the fork gets a worktree', async () => {
        const { registry, of, revealed } = fake({}, { chat: () => rowOf(info({ activeTurnId: null }), thread.slice(0, 1)) });
        expect(await registry.execute('chat.fork', { chatId: 'chat', turnId: null, title: null, branch: null }, VOICE_ACTION_CALL)).toMatchObject({
            status: 'completed',
            output: { nodeId: 'fork-1', chat: 'Research (fork)', branch: null }
        });
        expect(of('chat.fork')).toEqual([{ chatId: 'chat', turnId: 'turn-1', title: 'Research (fork)' }]);
        expect(revealed).toHaveLength(1);
        const asked = await registry.execute('chat.fork', { chatId: 'chat', turnId: null, title: 'Try B', branch: 'try-b' }, VOICE_ACTION_CALL);
        expect(consequences(asked)).toContain('worktree on the new branch try-b');
        expect(await confirm(registry, asked)).toMatchObject({ output: { branch: 'try-b' } });
    });

    test('Voice cannot fork while a turn runs', async () => {
        const { registry } = fake();
        expect(await registry.execute('chat.fork', { chatId: 'chat', turnId: 'turn-1', title: null, branch: null }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'cannot-fork' }
        });
    });
});

describe('plans', () => {
    test('Voice ticks a step anyone checks, never one the user checks alone', async () => {
        const { registry, applied } = fake();
        expect(
            await registry.execute('plan.setStepState', { chatId: 'chat', planId: null, stepIds: ['write'], state: 'done', note: null }, VOICE_ACTION_CALL)
        ).toMatchObject({ status: 'completed' });
        expect(applied).toEqual([{ chatId: 'chat', planId: 'p1', ops: [{ op: 'set', ids: ['write'], state: 'done' }] }]);
        expect(
            await registry.execute('plan.setStepState', { chatId: 'chat', planId: null, stepIds: ['look'], state: 'done', note: null }, VOICE_ACTION_CALL)
        ).toMatchObject({ error: { code: 'person-only' } });
        expect(
            await registry.execute('plan.setStepState', { chatId: 'chat', planId: null, stepIds: ['look'], state: 'done', note: null }, PERSON_ACTION_CALL)
        ).toMatchObject({ status: 'completed' });
    });

    test('the rules of the plan hold: a locked step, moving on and unlocking are not Voice’s', async () => {
        const { registry } = fake();
        expect(
            await registry.execute('plan.setStepState', { chatId: 'chat', planId: null, stepIds: ['locked'], state: 'done', note: null }, VOICE_ACTION_CALL)
        ).toMatchObject({ status: 'failed', error: { message: expect.stringContaining('Only the agent checks') } });
        expect(
            await registry.execute(
                'plan.setStepState',
                { chatId: 'chat', planId: null, stepIds: ['write'], state: 'done', note: null, next: 'look' },
                VOICE_ACTION_CALL
            )
        ).toMatchObject({ error: { code: 'forbidden-field' } });
        expect(await registry.execute('plan.unlock', { chatId: 'chat', planId: null, stepIds: null }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'forbidden-action' }
        });
        expect(await registry.execute('plan.unlock', { chatId: 'chat', planId: null, stepIds: null }, PERSON_ACTION_CALL)).toMatchObject({
            status: 'completed'
        });
    });

    test('a plan names its chat, and a note lands on its step', async () => {
        const { registry, applied } = fake();
        expect(await registry.execute('plan.read', { chatId: null, planId: null }, VOICE_ACTION_CALL)).toMatchObject({ error: { code: 'missing-chat' } });
        expect(await registry.execute('plan.read', { chatId: 'chat', planId: null }, VOICE_ACTION_CALL)).toMatchObject({ output: { plan: { id: 'p1' } } });
        await registry.execute('plan.addNote', { chatId: 'chat', planId: null, stepId: 'write', text: 'Blocked on review' }, VOICE_ACTION_CALL);
        expect(applied.at(-1)?.ops).toEqual([{ op: 'note', id: 'write', text: 'Blocked on review' }]);
    });
});

describe('the composer', () => {
    test('sends what was typed with its mentions and attachments, which only a person gives', async () => {
        const sent: unknown[] = [];
        const registry = createClientActionRegistry(useDocument, {
            sendChat: async (chatId, text, extras) => {
                sent.push({ chatId, text, extras });
                return { queued: false, turnId: 't' };
            }
        });
        const attachments = [{ name: 'a.png', mime: 'image/png', data: 'aGVsbG8=' }];
        expect(await registry.execute('chat.send', { chatId: 'chat', prompt: '', mentions: ['src/a.ts'], attachments }, PERSON_ACTION_CALL)).toMatchObject({
            status: 'completed'
        });
        expect(sent).toEqual([{ chatId: 'chat', text: '', extras: { mentions: ['src/a.ts'], attachments } }]);
        expect(await registry.execute('chat.send', { chatId: 'chat', prompt: 'Look', attachments }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'forbidden-field' }
        });
        expect(await registry.execute('chat.send', { chatId: 'chat', prompt: '  ' }, VOICE_ACTION_CALL)).toMatchObject({ error: { code: 'empty-prompt' } });
    });

    test('a clear from the composer does not stop a turn unasked, and a busy chat says so under its code', async () => {
        const forced: boolean[] = [];
        const registry = createClientActionRegistry(useDocument, {
            clearChat: async (_chatId, force) => {
                forced.push(force);
                if (!force) {
                    throw new TransportError('chat-busy', 'A turn is running');
                }
            }
        });
        expect(await registry.execute('chat.clear', { chatId: 'chat' }, PERSON_ACTION_CALL)).toMatchObject({ error: { code: 'chat-busy' } });
        expect(await registry.execute('chat.clear', { chatId: 'chat', force: true }, PERSON_ACTION_CALL)).toMatchObject({ status: 'completed' });
        expect(forced).toEqual([false, true]);
    });
});
