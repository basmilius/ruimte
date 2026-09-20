import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatItem, ChatTurnItem, ProjectContent } from '@ruimte/contracts';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, runVerb, type TestDaemon } from '../tasks/test-daemon.ts';
import { AgentLineageStore } from '../agents/lineage.ts';
import { STOPPED_TASK_REASON } from '../chat/chat-manager.ts';
import { TaskStore } from '../tasks/task-store.ts';
import { ENDED_REASON, endChildrenHandler, oweEndChildren, wireEndChildren, type EndChildrenDeps } from './end-children.ts';
import { OutboxStore } from './outbox.ts';
import { ManualClock } from './manual-clock.ts';
import type { EndChildrenEntry, OutboxEntry } from './outbox.ts';

const content = (): ProjectContent => ({
    name: 'repo',
    color: '#123456',
    views: [
        {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            nodes: [
                { id: 'chat-lead', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude' },
                { id: 'term-lead', kind: 'terminal', title: 'Shell', x: 0, y: 700, w: 560, h: 360 }
            ],
            texts: [],
            edges: [],
            layouts: []
        }
    ]
});

let root: string;
let home: string;
let folder: string;
let store: ProjectStore;
let projectId: string;
let clock: ManualClock;
let running: TestDaemon[];

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-end-children-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    store = new ProjectStore(home);
    const opened = await store.openProject({ folder });
    projectId = opened.summary.projectId;
    await store.save(projectId, opened.document.rev, content());
    store.release(projectId);
    clock = new ManualClock();
    running = [];
});

afterEach(async () => {
    for (const daemon of running) {
        await daemon.stop();
    }
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

const boot = async (): Promise<TestDaemon> => {
    const daemon = await bootTestDaemon({ home, store, clock });
    running.push(daemon);
    return daemon;
};

/* The lead in the middle of a turn, as it is while it runs the verbs. */
const leadWorking = async (daemon: TestDaemon): Promise<void> => {
    await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
    await daemon.chats.send('chat-lead', 'slow');
    await daemon.until(() => daemon.chats.get('chat-lead')?.info.agentSessionId !== null);
};

/* A chat child that is still working on its task, and a terminal child whose shell runs. */
const twoRunningChildren = async (daemon: TestDaemon): Promise<{ chat: string; terminal: string }> => {
    const [chatLine] = await runVerb(daemon, 'chat-lead', 'agent', ['claude', '--task', 'Slow', '--prompt', 'slow']);
    const [terminalLine] = await runVerb(daemon, 'chat-lead', 'agent', ['claude', '--terminal', '--task', 'Shell', '--prompt', 'work']);
    const chat = chatLine!.split('\t')[0]!;
    const terminal = terminalLine!.split('\t')[0]!;
    await daemon.worker.settled();
    await daemon.until(() => daemon.chats.get(chat)?.info.agentSessionId !== null && daemon.chats.get(chat)?.info.activeTurnId !== null);
    return { chat, terminal };
};

const turnsOf = (daemon: TestDaemon, chatId: string): ChatTurnItem[] =>
    (daemon.chats.get(chatId)?.thread.list() ?? []).filter((item): item is ChatTurnItem => item.kind === 'turn');

const notesOf = (daemon: TestDaemon, chatId: string): string[] =>
    (daemon.chats.get(chatId)?.thread.list() ?? []).flatMap((item: ChatItem) => (item.kind === 'note' ? [item.text] : []));

const withoutNode = (id: string) => (current: ProjectContent) => ({
    content: {
        ...current,
        views: current.views.map((view) => (view.kind === 'canvas' ? { ...view, nodes: view.nodes.filter((node) => node.id !== id) } : view))
    },
    result: null
});

describe('stopping or deleting a parent ends the agents it opened', () => {
    test('deleting a lead with two running children ends all three processes, cancels their tasks and wakes nobody', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadWorking(daemon);
        const { chat, terminal } = await twoRunningChildren(daemon);

        // What the confirmation counts before anything happens.
        expect(await daemon.request('agent.children', { nodeId: 'chat-lead' })).toMatchObject({ ok: true, result: { nodeIds: [chat, terminal] } });

        // A client deletes the node. The document loses it and the watcher kills its chat.
        await store.mutate(projectId, withoutNode('chat-lead'));
        expect(await daemon.request('chat.kill', { chatId: 'chat-lead' })).toMatchObject({ ok: true });
        await daemon.worker.settled();

        expect(daemon.chats.get('chat-lead')).toBeUndefined();
        const child = daemon.chats.get(chat)!;
        expect([child.running, child.info.activeTurnId, child.info.status]).toEqual([false, null, 'idle']);
        expect(turnsOf(daemon, chat).map((turn) => turn.state)).toEqual(['aborted']);
        expect(notesOf(daemon, chat)).toContain(ENDED_REASON);
        await daemon.adapter.forSession(terminal).exited;
        expect(daemon.sessions.get(terminal)?.exited).toBe(true);
        // The terminal stays listed with its last screen, since removing the node is a person's call.
        expect(daemon.adapter.forSession(terminal).signals.length).toBeGreaterThan(0);

        expect(daemon.tasks.ofParent('chat-lead')).toEqual([]);
        expect(daemon.outbox.list()).toEqual([]);
        expect(daemon.lineage.endedAt(chat)).not.toBeNull();
        expect(await daemon.request('agent.children', { nodeId: 'chat-lead' })).toMatchObject({ result: { nodeIds: [] } });
    });

    test("stopping a lead that stays cancels the children's tasks and never wakes it about them", async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadWorking(daemon);
        const { chat, terminal } = await twoRunningChildren(daemon);

        const owed = await daemon.endChildren.owe('chat-lead');
        expect(owed).toBe(2);
        // A second trigger for the same stop, as a delete gives, owes nothing more. What it answers is
        // what is left to end, which the cascade this one already started may have taken a bite out of.
        await daemon.endChildren.owe('chat-lead');
        expect(daemon.outbox.list().filter((entry) => entry.kind === 'end-children')).toHaveLength(1);
        await daemon.worker.settled();
        await daemon.adapter.forSession(terminal).exited;
        expect(daemon.sessions.get(terminal)?.exited).toBe(true);

        expect(daemon.tasks.ofParent('chat-lead').map((task) => [task.status, task.wake, task.result?.text])).toEqual([
            ['cancelled', 'none', ENDED_REASON],
            ['cancelled', 'none', ENDED_REASON]
        ]);
        // The lead ends its own turn; nothing it gave wakes it.
        daemon.chats.cancel('chat-lead');
        await daemon.until(() => daemon.chats.get('chat-lead')?.info.activeTurnId === null);
        await daemon.worker.settled();
        expect(turnsOf(daemon, 'chat-lead').filter((turn) => turn.taskIds !== undefined)).toEqual([]);
        expect(daemon.alerts).toEqual([]);
        expect(daemon.chats.get(chat)?.running).toBe(false);
    });

    test('a restart between the confirmation and the children ending still ends them, and the chat child is not resumed', async () => {
        const before = await boot();
        before.worker.start();
        await leadWorking(before);
        const { chat, terminal } = await twoRunningChildren(before);
        before.worker.stop();

        // The person confirmed. The daemon owes the ending and kills the lead, and goes down before the worker ran it.
        await store.mutate(projectId, withoutNode('chat-lead'));
        expect(await before.request('chat.kill', { chatId: 'chat-lead' })).toMatchObject({ ok: true });
        expect(before.outbox.list().map((entry) => entry.kind)).toEqual(['end-children']);
        await before.stop();
        running = running.filter((daemon) => daemon !== before);

        const after = await boot();
        // Both halves of a start. The chats whose turn ran are loaded, and the worker takes up what is owed.
        after.worker.start();
        await after.chats.recoverInterrupted();
        await after.worker.settled();

        const child = after.chats.get(chat)!;
        expect([child.running, child.info.activeTurnId]).toEqual([false, null]);
        expect(turnsOf(after, chat).map((turn) => turn.state)).toEqual(['aborted']);
        expect(after.claude.started).toEqual([]);
        expect(after.sessions.get(terminal)).toBeUndefined();
        expect(after.lineage.endedAt(chat)).not.toBeNull();
        expect(after.lineage.endedAt(terminal)).not.toBeNull();
        expect(after.outbox.list()).toEqual([]);
    });

    test('a terminal lead that is stopped takes its agents along, and restarting one that already exited ends nothing', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await daemon.sessions.create({ sessionId: 'term-lead', cols: 80, rows: 24, cwd: folder, agent: { kind: 'claude', runtimeMode: 'full-access' } });
        const [line] = await runVerb(daemon, 'term-lead', 'agent', ['claude', '--terminal', '--prompt', 'work']);
        const child = line!.split('\t')[0]!;
        await daemon.worker.settled();

        // The lead's shell ends on its own, and a person presses Restart, which kills the exited session.
        daemon.adapter.forSession('term-lead').exit(0);
        expect(await daemon.request('session.kill', { sessionId: 'term-lead' })).toMatchObject({ ok: true });
        await daemon.worker.settled();
        expect(daemon.sessions.get(child)?.exited).toBe(false);

        await daemon.sessions.create({ sessionId: 'term-lead', cols: 80, rows: 24, cwd: folder, agent: { kind: 'claude', runtimeMode: 'full-access' } });
        expect(await daemon.request('session.kill', { sessionId: 'term-lead' })).toMatchObject({ ok: true });
        await daemon.worker.settled();
        await daemon.adapter.forSession(child).exited;
        expect(daemon.sessions.get(child)?.exited).toBe(true);
    });

    test('a lead that leaves the document without any kill, as an agent rewriting the file would, still ends its agents', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadWorking(daemon);
        const { chat } = await twoRunningChildren(daemon);
        await store.mutate(projectId, withoutNode('chat-lead'));
        await daemon.until(() => daemon.outbox.list().some((entry) => entry.kind === 'end-children') || daemon.lineage.endedAt(chat) !== null);
        await daemon.worker.settled();
        expect(daemon.chats.get(chat)?.info.activeTurnId).toBeNull();
        expect(daemon.lineage.endedAt(chat)).not.toBeNull();
    });

    test('an agent never opens one in a wider mode than its own', async () => {
        const daemon = await boot();
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder, runtimeMode: 'supervised' });
        const [refusal] = await runVerb(daemon, 'chat-lead', 'agent', ['claude', '--mode', 'full-access']);
        expect(refusal).toStartWith('refused\tmode-above-parent\t');
        // A person's wider composer pick does not reach a chat the lead opens either.
        daemon.chats.composerPreferences.set('client-1', { runtimeMode: 'full-access', changedAt: 1 });
        const [line] = await runVerb(daemon, 'chat-lead', 'agent', ['claude']);
        daemon.worker.start();
        await daemon.worker.settled();
        expect(daemon.chats.get(line!.split('\t')[0]!)?.info.runtimeMode).toBe('supervised');
    });

    test('a terminal agent counts as the mode its hooks report, not the one it was launched in', async () => {
        const daemon = await boot();
        await daemon.sessions.create({ sessionId: 'term-lead', cols: 80, rows: 24, cwd: folder, agent: { kind: 'claude', runtimeMode: 'full-access' } });
        const token = daemon.sessions.get('term-lead')!.hookToken;
        await daemon.sessions.applyHook('claude', token, { session_id: 'c1', hook_event_name: 'UserPromptSubmit', permission_mode: 'default' });
        const [refusal] = await runVerb(daemon, 'term-lead', 'agent', ['claude', '--mode', 'auto-accept-edits']);
        expect(refusal).toStartWith('refused\tmode-above-parent\tYou run in supervised');

        await daemon.sessions.applyHook('claude', token, { session_id: 'c1', hook_event_name: 'Stop', permission_mode: 'bypassPermissions' });
        const [line] = await runVerb(daemon, 'term-lead', 'agent', ['claude', '--mode', 'full-access']);
        expect(line).not.toStartWith('refused');
    });
});

/* A background subagent of the CLI's own that still runs in the lead's thread. */
const nativeRunning = (daemon: TestDaemon, toolUseId: string): void => {
    daemon.chats.get('chat-lead')!.thread.upsert({
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
        itemsTruncated: false
    });
};

describe("stopping a chat's turn together with its sub-agents", () => {
    test('ends every agent it opened without waking it, marks its own subagents stopped and keeps the chat', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadWorking(daemon);
        const { chat, terminal } = await twoRunningChildren(daemon);
        nativeRunning(daemon, 'toolu_bg');

        expect(await daemon.request('chat.cancel', { chatId: 'chat-lead', subagents: true })).toMatchObject({ ok: true });
        await daemon.until(() => daemon.chats.get('chat-lead')?.info.activeTurnId === null);
        await daemon.worker.settled();
        await daemon.adapter.forSession(terminal).exited;

        expect(daemon.chats.get(chat)?.running).toBe(false);
        expect(daemon.sessions.get(terminal)?.exited).toBe(true);
        expect(daemon.tasks.ofParent('chat-lead').map((task) => [task.status, task.wake])).toEqual([
            ['cancelled', 'none'],
            ['cancelled', 'none']
        ]);
        const lead = daemon.chats.get('chat-lead')!;
        expect(lead.thread.get('1:toolu_bg')).toMatchObject({ status: 'failed', finishedAt: expect.any(Number) });
        expect(notesOf(daemon, 'chat-lead').some((text) => text.startsWith('"Review the branch" was marked as stopped.'))).toBe(true);
        expect(turnsOf(daemon, 'chat-lead').filter((turn) => turn.taskIds !== undefined)).toEqual([]);
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('a plain stop leaves the agents it opened and its own subagents running', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadWorking(daemon);
        const { chat } = await twoRunningChildren(daemon);
        nativeRunning(daemon, 'toolu_bg');

        expect(await daemon.request('chat.cancel', { chatId: 'chat-lead' })).toMatchObject({ ok: true });
        await daemon.until(() => daemon.chats.get('chat-lead')?.info.activeTurnId === null);
        await daemon.worker.settled();

        expect(daemon.outbox.list().some((entry) => entry.kind === 'end-children')).toBe(false);
        expect(daemon.lineage.endedAt(chat)).toBeNull();
        expect(daemon.chats.get('chat-lead')?.thread.get('1:toolu_bg')).toMatchObject({ status: 'running' });
    });

    test('a restart right after the stop still ends the agents it opened', async () => {
        const before = await boot();
        before.worker.start();
        await leadWorking(before);
        const { chat, terminal } = await twoRunningChildren(before);
        before.worker.stop();

        expect(await before.request('chat.cancel', { chatId: 'chat-lead', subagents: true })).toMatchObject({ ok: true });
        expect(before.outbox.list().map((entry) => entry.kind)).toEqual(['end-children']);
        await before.stop();
        running = running.filter((daemon) => daemon !== before);

        const after = await boot();
        after.worker.start();
        await after.chats.recoverInterrupted();
        await after.worker.settled();

        expect(after.chats.get(chat)?.running).toBe(false);
        expect(after.sessions.get(terminal)).toBeUndefined();
        expect(after.lineage.endedAt(chat)).not.toBeNull();
        expect(after.lineage.endedAt(terminal)).not.toBeNull();
        expect(after.outbox.list()).toEqual([]);
    });
});

describe('stopping one task from the list of the chat that gave it', () => {
    test('ends the child as a stop of its node would, cancels its task without waking the lead, and leaves the sibling running', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadWorking(daemon);
        const { chat, terminal } = await twoRunningChildren(daemon);
        const task = daemon.tasks.ofParent('chat-lead').find((candidate) => candidate.childId === chat)!;

        expect(await daemon.request('chat.stopSubagent', { chatId: 'chat-lead', toolUseId: `task-${task.id}` })).toMatchObject({ ok: true });
        await daemon.worker.settled();

        const child = daemon.chats.get(chat)!;
        expect([child.running, child.info.activeTurnId]).toEqual([false, null]);
        expect(notesOf(daemon, chat)).toContain(STOPPED_TASK_REASON);
        expect(daemon.lineage.endedAt(chat)).not.toBeNull();
        expect(daemon.tasks.ofParent('chat-lead').map((candidate) => [candidate.childId, candidate.status, candidate.wake])).toEqual([
            [chat, 'cancelled', 'none'],
            [terminal, 'open', 'pending']
        ]);
        expect(daemon.chats.get('chat-lead')?.thread.get(`task-${task.id}`)).toMatchObject({ status: 'failed' });
        expect(daemon.sessions.get(terminal)?.exited).toBe(false);

        // The lead ends its turn and is woken about nothing. The stopped task never wakes anyone.
        daemon.chats.cancel('chat-lead');
        await daemon.until(() => daemon.chats.get('chat-lead')?.info.activeTurnId === null);
        await daemon.worker.settled();
        expect(turnsOf(daemon, 'chat-lead').filter((turn) => turn.taskIds !== undefined)).toEqual([]);
    });
});

describe('the handler on its own', () => {
    const fakeDeps = (tree: Record<string, string[]>, entries: OutboxEntry[] = []) => {
        const calls: string[] = [];
        const ended = new Set<string>();
        const descendants = (nodeId: string): string[] => {
            const found: string[] = [];
            const walk = (id: string): void => {
                for (const child of tree[id] ?? []) {
                    if (!ended.has(child)) {
                        found.push(child);
                    }
                }
                for (const child of tree[id] ?? []) {
                    walk(child);
                }
            };
            walk(nodeId);
            return found.filter((id) => !ended.has(id));
        };
        const deps: EndChildrenDeps = {
            descendants,
            projectOf: () => 'project',
            markEnded: async (ids) => {
                calls.push(`mark ${ids.join(',')}`);
                ids.forEach((id) => ended.add(id));
            },
            entries: () => entries,
            enqueue: async (_projectId, target, work) => {
                calls.push(`owe ${target} ${JSON.stringify(work.payload)}`);
            },
            remove: async (id) => {
                calls.push(`remove ${id}`);
            },
            cancelTasks: async (ids) => {
                calls.push(`cancel ${[...ids].join(',')}`);
            },
            stop: async (id) => {
                calls.push(`stop ${id}`);
            }
        };
        return { calls, deps };
    };

    const entry = (nodeIds: string[]): EndChildrenEntry => ({
        kind: 'end-children',
        id: 'end-children-1',
        projectId: 'project',
        target: 'lead',
        createdAt: 1,
        attempts: 0,
        notBefore: 1,
        payload: { nodeIds }
    });

    test('marks first, takes away what would revive a child, cancels, then stops the leaves before their parents', async () => {
        const resume: OutboxEntry = {
            kind: 'resume-run',
            id: 'resume-1',
            projectId: 'project',
            target: 'child',
            createdAt: 0,
            attempts: 0,
            notBefore: 0,
            payload: { turnId: 't', attempt: 2 }
        };
        const other: OutboxEntry = { ...resume, id: 'resume-2', target: 'stranger' };
        const { calls, deps } = fakeDeps({ lead: ['child'], child: ['grandchild'] }, [resume, other]);
        await endChildrenHandler(deps)(entry(['child']));
        expect(calls).toEqual(['mark child,grandchild', 'remove resume-1', 'cancel child,grandchild', 'stop grandchild', 'stop child']);
        // Run again after a restart halfway, it ends the same nodes out of what the entry held.
        calls.length = 0;
        await endChildrenHandler(deps)(entry(['child']));
        expect(calls).toEqual(['mark child', 'remove resume-1', 'cancel child', 'stop child']);
    });

    test('owes nothing for a node that opened no agents', async () => {
        const { calls, deps } = fakeDeps({});
        expect(await oweEndChildren(deps)('lead')).toBe(0);
        expect(calls).toEqual([]);
    });
});

test('what the index says while it warms at start is owed only once the outbox can take work', async () => {
    const lineage = new AgentLineageStore(home);
    await lineage.put({ projectId: 'project', nodeId: 'child', openedBy: 'gone-lead', depth: 1, agent: true });
    const owed: string[] = [];
    const wiring = wireEndChildren({
        lineage,
        outbox: new OutboxStore(home),
        tasks: new TaskStore(home),
        chats: { get: () => undefined, stop: async () => undefined },
        sessions: { get: () => undefined, end: async () => undefined },
        enqueue: async (_projectId, target) => {
            owed.push(target);
        }
    });
    // The lead was deleted while the daemon was down. The warm index no longer places it.
    wiring.places('project', new Set(['child']));
    expect(owed).toEqual([]);
    wiring.start();
    await Promise.resolve();
    expect(owed).toEqual(['gone-lead']);
});
