import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_NOTICE_LENGTH, MAX_TITLE_LENGTH, type ActionInput } from '@ruimte/actions';
import type { ProjectContent, ProjectNode, Task } from '@ruimte/contracts';
import { SubagentUnreadable } from '../context/context-store.ts';
import type { Notice } from '../context/notices.ts';
import type { AgentState, CanvasHost } from '../canvas/verb.ts';
import { PlanStore } from '../plans/plan-store.ts';
import { ProjectError } from '../projects/project-store.ts';
import { serverActionCall } from './context.ts';
import { serverActions } from './server-actions.ts';

const PLACE = { projectId: 'project-1', folder: '/nowhere', canvasId: 'main' };

let content: ProjectContent;
let made: Map<string, string>;
let ended: string[];
let conflict: boolean;
let rev: number;
// Stands for a write that lands between the check before an action and its own write.
let writtenMeanwhile: boolean;
let notices: Omit<Notice, 'createdAt'>[];
let tasks: Task[];
let settled: string[];
let plans: PlanStore;
let home: string;

/* Only what these handlers reach; anything else is a handler reaching further than it should. */
const host = (): CanvasHost =>
    ({
        read: async () => content,
        revision: async () => (writtenMeanwhile ? rev - 1 : rev),
        mutate: async (_projectId, apply, expectedRev) => {
            if (conflict || (expectedRev !== undefined && expectedRev !== rev)) {
                throw new ProjectError('rev-conflict', 'The project changed since it was read');
            }
            const mutation = await apply(content);
            if (mutation.content !== null) {
                content = mutation.content;
                rev += 1;
            }
            return mutation.result;
        },
        context: {
            list: (targetId: string) => (targetId === 'term-1' ? [{ id: 'note-1', kind: 'text' as const, title: 'Plan' }] : []),
            read: async (targetId: string, sourceId: string, tail: number | null, subagent: string | null) => {
                if (targetId !== 'term-1' || sourceId !== 'note-1') {
                    throw new ProjectError('project-not-found', 'not used here');
                }
                if (subagent !== null) {
                    throw new SubagentUnreadable('note-1 is a text, and only a chat has subagents');
                }
                return tail === null ? 'one\ntwo' : 'two';
            }
        },
        recordMade: async (record) => {
            made.set(record.nodeId, record.openedBy);
        },
        madeBy: (nodeId) => made.get(nodeId) ?? null,
        agentsDeleteAnyView: () => false,
        endSession: async (kind, nodeId) => {
            ended.push(`${kind}\t${nodeId}`);
        },
        notify: async (notice) => {
            notices.push(notice);
            return { at: 'waiting', wake: false, detail: 'that chat is in a turn' };
        },
        tasks: {
            involving: (nodeId: string) => tasks.filter((task) => task.parentId === nodeId || task.childId === nodeId),
            chatState: async () => 'idle',
            done: async (childId: string, text: string) => {
                const open = tasks.find((task) => task.childId === childId && task.status === 'open');
                if (!open) {
                    return null;
                }
                settled.push(text);
                open.status = 'done';
                return open;
            }
        } as Partial<CanvasHost['tasks']> as CanvasHost['tasks'],
        plans,
        browsers: { drive: async () => null, shot: async () => null }
    }) as Partial<CanvasHost> as CanvasHost;

const agent = (dryRun = false) => serverActionCall(host(), PLACE, 'term-1', dryRun);

const note = (input: Partial<ActionInput<'node.create'>> = {}): ActionInput<'node.create'> => ({
    viewId: 'main',
    kind: 'note',
    title: null,
    content: 'hello',
    url: null,
    command: null,
    path: null,
    provider: null,
    at: null,
    ...input
});

const nodesOnMain = (): string[] => {
    const main = content.views.find((view) => view.id === 'main');
    return main?.kind === 'canvas' ? main.nodes.map((node) => node.id) : [];
};

const as = (caller: string, dryRun = false) => serverActionCall(host(), PLACE, caller, dryRun);

const openTask = (childId: string, parentId: string): Task => ({
    id: `task-${childId}`,
    projectId: PLACE.projectId,
    parentId,
    childId,
    title: 'Look into it',
    prompt: 'Look into it',
    status: 'open',
    result: null,
    createdAt: 0,
    settledAt: null,
    wake: 'pending'
});

const onMain = (...nodes: ProjectNode[]): void => {
    const main = content.views.find((view) => view.id === 'main');
    if (main?.kind === 'canvas') {
        main.nodes.push(...nodes);
    }
};

const lineOnMain = (from: string, to: string): void => {
    const main = content.views.find((view) => view.id === 'main');
    if (main?.kind === 'canvas') {
        main.edges.push({ id: `${from}-${to}`, from, to });
    }
};

beforeEach(async () => {
    made = new Map();
    ended = [];
    conflict = false;
    rev = 1;
    writtenMeanwhile = false;
    notices = [];
    tasks = [];
    settled = [];
    home = await mkdtemp(join(tmpdir(), 'ruimte-server-actions-'));
    plans = new PlanStore(home);
    content = {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [
                    { id: 'term-1', kind: 'terminal', title: 'shell', x: 0, y: 0, w: 560, h: 360 },
                    { id: 'term-2', kind: 'terminal', title: 'other', x: 0, y: 600, w: 560, h: 360 }
                ],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    };
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('the daemon actions', () => {
    test('a dry run of node.create answers the node and the line it would make, and makes neither', async () => {
        const result = await serverActions.execute('node.create', note(), agent(true));
        expect(result).toMatchObject({
            status: 'completed',
            dryRun: true,
            output: { viewId: 'main', nodeId: '<new node>', kind: 'note', edge: { edgeId: null, from: 'term-1', to: '<new node>' } }
        });
        expect(nodesOnMain()).toEqual(['term-1', 'term-2']);
        expect(made.size).toBe(0);
    });

    test('an action that makes nothing to preview refuses a dry run instead of running for real', async () => {
        const result = await serverActions.execute('link.create', { viewId: 'main', from: null, to: ['term-2'], label: null, role: null }, agent(true));
        expect(result).toMatchObject({ status: 'failed', error: { code: 'no-dry-run' } });
        const main = content.views.find((view) => view.id === 'main');
        expect(main?.kind === 'canvas' ? main.edges : null).toEqual([]);
    });

    test('an agent starts no CLI and no command through node.create or view.create', async () => {
        expect(await serverActions.execute('node.create', note({ kind: 'terminal', content: null, command: 'rm -rf /' }), agent())).toMatchObject({
            status: 'failed',
            error: { code: 'starts-nothing' }
        });
        expect(await serverActions.execute('node.create', note({ kind: 'chat', content: null, provider: 'claude' }), agent())).toMatchObject({
            status: 'failed',
            error: { code: 'starts-nothing' }
        });
        expect(
            await serverActions.execute('view.create', { kind: 'chat', name: 'Helper', url: null, command: null, path: null, provider: 'codex' }, agent())
        ).toMatchObject({ status: 'failed', error: { code: 'starts-nothing' } });
        expect(nodesOnMain()).toEqual(['term-1', 'term-2']);
    });

    test('what only a person gives is refused from an agent before the daemon reads it', async () => {
        const view = { name: 'Phone', url: null, command: null, path: null, provider: null };
        expect(
            await serverActions.execute(
                'view.create',
                { ...view, kind: 'device', device: { platform: 'ios', kind: 'simulator', name: 'iPhone 17', runtime: 'iOS 27.0' } },
                agent()
            )
        ).toMatchObject({ status: 'failed', error: { code: 'forbidden-field' } });
        expect(await serverActions.execute('view.create', { ...view, kind: 'terminal', resume: 'sess-1' }, agent())).toMatchObject({
            status: 'failed',
            error: { code: 'forbidden-field' }
        });
        expect(await serverActions.execute('node.create', note({ resume: 'sess-1' }), agent())).toMatchObject({
            status: 'failed',
            error: { code: 'forbidden-field' }
        });
        expect(nodesOnMain()).toEqual(['term-1', 'term-2']);
    });

    test('a line given no label or role reads, so between two agents it is drawn both ways', async () => {
        const drawn = await serverActions.execute('link.create', { viewId: 'main', from: null, to: ['term-2'] }, agent());
        expect(drawn).toMatchObject({
            status: 'completed',
            output: {
                edges: [
                    { from: 'term-1', to: 'term-2', state: 'new', way: 'out' },
                    { from: 'term-2', to: 'term-1', state: 'new', way: 'back' }
                ]
            }
        });
    });

    test('node.delete removes only what the caller made, and ends the session it held', async () => {
        const refused = await serverActions.execute('node.delete', { viewId: 'main', nodeIds: ['term-2'] }, agent());
        expect(refused).toMatchObject({ status: 'failed', error: { code: 'not-yours' } });

        made.set('term-2', 'term-1');
        const deleted = await serverActions.execute('node.delete', { viewId: 'main', nodeIds: ['term-2'] }, agent());
        expect(deleted).toMatchObject({ status: 'completed', output: { removed: [{ nodeId: 'term-2', kind: 'terminal', ended: true }] } });
        expect(ended).toEqual(['terminal\tterm-2']);
        expect(nodesOnMain()).toEqual(['term-1']);
    });

    test('a write the store refuses comes back under the store code, with nothing written', async () => {
        conflict = true;
        expect(await serverActions.execute('node.create', note(), agent())).toMatchObject({ status: 'failed', error: { code: 'rev-conflict' } });
        expect(nodesOnMain()).toEqual(['term-1', 'term-2']);
    });

    test('only an agent reaches the actions an agent alone may run', async () => {
        const call = { ...agent(), actor: { kind: 'voice' as const, id: 'voice' } };
        expect(await serverActions.execute('node.list', { viewId: 'main' }, call)).toMatchObject({ status: 'failed', error: { code: 'forbidden-action' } });
    });

    test('agent.notify travels only along a line from the caller into an agent, and says where the message went', async () => {
        const refused = await serverActions.execute('agent.notify', { nodeId: 'term-2', text: 'hello' }, agent());
        expect(refused).toMatchObject({ status: 'failed', error: { code: 'not-linked' } });
        expect(notices).toEqual([]);

        lineOnMain('term-1', 'term-2');
        const sent = await serverActions.execute('agent.notify', { nodeId: 'term-2', text: 'hello' }, agent());
        expect(sent).toMatchObject({ status: 'completed', output: { nodeId: 'term-2', at: 'waiting' } });
        expect(notices).toMatchObject([{ targetId: 'term-2', from: 'term-1', fromTitle: 'shell', text: 'hello' }]);

        const voice = { ...agent(), actor: { kind: 'voice' as const, id: 'voice' } };
        expect(await serverActions.execute('agent.notify', { nodeId: 'term-2', text: 'hello' }, voice)).toMatchObject({
            status: 'failed',
            error: { code: 'forbidden-action' }
        });
    });

    test('task.create gives a task only to a chat the caller opened itself', async () => {
        onMain(
            { id: 'chat-1', kind: 'chat', title: 'lead', x: 0, y: 1200, w: 560, h: 360 },
            { id: 'chat-2', kind: 'chat', title: 'helper', x: 700, y: 1200, w: 560, h: 360 }
        );
        const input = { nodeId: 'chat-2', prompt: 'Look into it', title: null };
        expect(await serverActions.execute('task.create', input, as('term-1'))).toMatchObject({ status: 'failed', error: { code: 'not-a-chat-parent' } });
        expect(await serverActions.execute('task.create', input, as('chat-1'))).toMatchObject({ status: 'failed', error: { code: 'not-yours' } });
    });

    test('task.complete settles the open task of the caller once and refuses a second result', async () => {
        tasks = [openTask('term-1', 'chat-9')];
        expect(await serverActions.execute('task.complete', { result: '  it works  ' }, agent())).toMatchObject({
            status: 'completed',
            output: { taskId: 'task-term-1', parentId: 'chat-9' }
        });
        expect(settled).toEqual(['it works']);
        expect(await serverActions.execute('task.complete', { result: 'again' }, agent())).toMatchObject({
            status: 'failed',
            error: { code: 'no-open-task' }
        });
        expect(settled).toEqual(['it works']);
    });

    test('a dry run of plan.create writes nothing, and a step only a person checks stays out of reach of an agent', async () => {
        onMain({ id: 'chat-1', kind: 'chat', title: 'lead', x: 0, y: 1200, w: 560, h: 360 });
        const document = JSON.stringify({ meta: { title: 'Check it' }, items: [{ type: 'step', id: 'look', title: 'Look', checks: 'person' }] });
        const create = { document, markdown: null, title: null, kind: null, checks: null };

        expect(await serverActions.execute('plan.create', create, as('chat-1', true))).toMatchObject({ status: 'completed', dryRun: true });
        expect(await plans.read('chat-1')).toEqual([]);

        expect(await serverActions.execute('plan.create', create, as('chat-1'))).toMatchObject({ status: 'completed' });
        const set = await serverActions.execute('plan.setStepState', { planId: null, stepIds: ['look'], state: 'done', note: null, next: null }, as('chat-1'));
        expect(set).toMatchObject({ status: 'failed', error: { code: 'person-only' } });
        expect(await serverActions.execute('plan.list', {}, as('term-1'))).toMatchObject({ status: 'failed', error: { code: 'plan-needs-chat' } });
    });

    test('the lengths a CLI flag held are held for every call of the action', async () => {
        lineOnMain('term-1', 'term-2');
        expect(await serverActions.execute('agent.notify', { nodeId: 'term-2', text: 'x'.repeat(MAX_NOTICE_LENGTH + 1) }, agent())).toMatchObject({
            status: 'failed',
            error: { code: 'invalid-input' }
        });
        expect(
            await serverActions.execute(
                'link.create',
                { viewId: 'main', from: null, to: ['term-2'], label: 'L'.repeat(MAX_TITLE_LENGTH + 1), role: null },
                agent()
            )
        ).toMatchObject({ status: 'failed', error: { code: 'invalid-input' } });
        expect(notices).toEqual([]);
    });

    test("agent.start and team.start are an agent's alone", async () => {
        const voice = { ...agent(), actor: { kind: 'voice' as const, id: 'voice' } };
        const start = {
            provider: 'claude' as const,
            terminal: false,
            prompt: null,
            promptFile: null,
            cwd: null,
            reads: null,
            viewId: null,
            beside: null,
            group: null,
            title: null,
            task: null,
            model: null,
            mode: null,
            worktree: false,
            branch: null
        };
        expect(await serverActions.execute('agent.start', start, voice)).toMatchObject({ status: 'failed', error: { code: 'forbidden-action' } });
        expect(await serverActions.execute('worktree.merge', { branch: 'lexer', strategy: 'merge', message: null }, voice)).toMatchObject({
            status: 'failed',
            error: { code: 'forbidden-action' }
        });
    });

    test('operation.get reads a start off what runs in its node, and only for the one who started it', async () => {
        const states: Record<string, AgentState> = { 'term-2': 'needs-you' };
        const call = (caller: string) =>
            serverActionCall(
                {
                    ...host(),
                    locate: (id: string) => (nodesOnMain().includes(id) ? PLACE : null),
                    agents: { stateOf: async (id: string) => states[id] ?? 'none', startedBy: (id: string) => made.get(id) ?? null, cancelTurn: () => false }
                },
                PLACE,
                caller
            );
        made.set('term-2', 'term-1');

        expect(await serverActions.execute('operation.get', { operationId: 'agent.start:term-2' }, call('term-1'))).toMatchObject({
            status: 'completed',
            output: { action: 'agent.start', status: 'running', agents: [{ nodeId: 'term-2', status: 'running', taskId: null }] }
        });
        for (const [state, status] of [
            ['error', 'failed'],
            ['ended', 'cancelled'],
            ['stopped', 'cancelled'],
            ['exited', 'completed'],
            ['owed', 'queued'],
            ['none', 'failed']
        ] as const) {
            states['term-2'] = state;
            expect(await serverActions.execute('operation.get', { operationId: 'agent.start:term-2' }, call('term-1'))).toMatchObject({ output: { status } });
        }
        expect(await serverActions.execute('operation.get', { operationId: 'agent.start:term-2' }, call('term-9'))).toMatchObject({
            status: 'failed',
            error: { code: 'not-yours' }
        });
        expect(await serverActions.execute('operation.get', { operationId: 'node.create:term-2' }, call('term-1'))).toMatchObject({
            status: 'failed',
            error: { code: 'unknown-operation' }
        });
    });

    test('operation.cancel stops the turn of a chat its caller started, and leaves a terminal agent and an owed start running', async () => {
        onMain({ id: 'chat-2', kind: 'chat', title: 'Helper', x: 700, y: 0, w: 560, h: 360 });
        const states: Record<string, AgentState> = { 'chat-2': 'running', 'term-2': 'running' };
        const stopped: string[] = [];
        const call = (caller: string) =>
            serverActionCall(
                {
                    ...host(),
                    locate: (id: string) => (nodesOnMain().includes(id) ? PLACE : null),
                    agents: {
                        stateOf: async (id: string) => states[id] ?? 'none',
                        startedBy: (id: string) => made.get(id) ?? null,
                        cancelTurn: (id: string) => {
                            if (id !== 'chat-2' || states[id] !== 'running') {
                                return false;
                            }
                            stopped.push(id);
                            return true;
                        }
                    }
                },
                PLACE,
                caller
            );
        made.set('chat-2', 'term-1');
        made.set('term-2', 'term-1');

        expect(await serverActions.execute('operation.cancel', { operationId: 'team.start:chat-2,term-2' }, call('term-1'))).toMatchObject({
            status: 'completed',
            output: {
                operations: [
                    { status: 'cancelled', detail: expect.stringContaining('chat-2') },
                    { status: 'left', detail: expect.stringContaining('signal a person did not press') }
                ]
            }
        });
        expect(stopped).toEqual(['chat-2']);
        states['term-2'] = 'owed';
        states['chat-2'] = 'idle';
        expect(await serverActions.execute('operation.cancel', { operationId: 'team.start:chat-2,term-2' }, call('term-1'))).toMatchObject({
            output: { operations: [{ status: 'over' }, { status: 'left', detail: expect.stringContaining('owed') }] }
        });
        expect(await serverActions.execute('operation.cancel', { operationId: 'agent.start:chat-2' }, call('term-9'))).toMatchObject({
            status: 'failed',
            error: { code: 'not-yours' }
        });
        expect(await serverActions.execute('operation.cancel', { operationId: null }, call('term-1'))).toMatchObject({
            status: 'failed',
            error: { code: 'unknown-operation' }
        });
        expect(await serverActions.execute('operation.cancel', { operationId: 'git:run-1' }, call('term-1'))).toMatchObject({
            status: 'failed',
            error: { code: 'unknown-operation' }
        });
        expect(stopped).toEqual(['chat-2']);
    });

    test('a browser page nobody holds is an answer and not an error, and only a line lets the caller drive it', async () => {
        onMain({ id: 'web-1', kind: 'browser', title: 'Docs', url: 'https://example.com', x: 700, y: 0, w: 560, h: 360 });
        expect(await serverActions.execute('browser.back', { nodeId: 'web-1' }, agent())).toMatchObject({ status: 'failed', error: { code: 'not-linked' } });

        lineOnMain('term-1', 'web-1');
        expect(await serverActions.execute('browser.back', { nodeId: 'web-1' }, agent())).toMatchObject({
            status: 'completed',
            output: { nodeId: 'web-1', open: false, page: null, error: null }
        });
    });

    test('a write decided on the revision it read goes through, and one decided before a change refuses and changes nothing', async () => {
        const listed = await serverActions.execute('node.list', { viewId: 'main' }, agent());
        expect(listed).toMatchObject({ status: 'completed', output: { revision: 1 } });
        const decided = serverActionCall(host(), PLACE, 'term-1', false, 1);
        expect(await serverActions.execute('node.create', note(), decided)).toMatchObject({ status: 'completed' });
        expect(await serverActions.execute('node.create', note(), decided)).toMatchObject({
            status: 'failed',
            error: { code: 'rev-conflict', message: 'The project is at revision 2, and this call was decided on 1; read it again and decide anew.' }
        });
        expect(nodesOnMain()).toHaveLength(3);
        // A read has nothing to hold, so a revision on it changes nothing.
        expect(await serverActions.execute('link.list', { viewId: 'main' }, decided)).toMatchObject({ status: 'completed', output: { revision: 2 } });
    });

    test('the first write holds the revision under its own lock, so a write that lands after the check still refuses', async () => {
        writtenMeanwhile = true;
        expect(await serverActions.execute('node.create', note(), serverActionCall(host(), PLACE, 'term-1', false, 0))).toMatchObject({
            status: 'failed',
            error: { code: 'rev-conflict' }
        });
        expect(nodesOnMain()).toEqual(['term-1', 'term-2']);
    });

    test('a write to anything but the project file refuses a revision rather than ignore it', async () => {
        expect(
            await serverActions.execute(
                'plan.create',
                { document: null, markdown: '- [ ] Ship', title: null, kind: null, checks: null },
                serverActionCall(host(), PLACE, 'term-1', false, 1)
            )
        ).toMatchObject({
            status: 'failed',
            error: { code: 'no-revision' }
        });
    });

    test('context.list and context.read answer what is linked into the caller, even one no project places', async () => {
        const unplaced = serverActionCall(host(), null, 'term-1');
        expect(await serverActions.execute('context.list', {}, unplaced)).toEqual({
            status: 'completed',
            action: 'context.list',
            output: { sources: [{ id: 'note-1', kind: 'text', title: 'Plan' }] }
        });
        expect(await serverActions.execute('context.read', { sourceId: 'note-1', tail: 1, subagent: null }, unplaced)).toMatchObject({
            output: { text: 'two' }
        });
        expect(await serverActions.execute('context.read', { sourceId: 'note-1', tail: null, subagent: 'toolu_1' }, unplaced)).toMatchObject({
            status: 'failed',
            error: { code: 'unknown-subagent', message: 'note-1 is a text, and only a chat has subagents' }
        });
        expect(await serverActions.execute('node.list', { viewId: 'main' }, unplaced)).toMatchObject({ status: 'failed', error: { code: 'not-in-project' } });
    });
});
