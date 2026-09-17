import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatItem, ChatSubagentItem, ChatTurnItem, ProjectContent } from '@ruimte/contracts';
import { nextLine } from '../canvas/task-verbs.ts';
import { ManualClock } from '../outbox/manual-clock.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, runVerb, type TestDaemon } from './test-daemon.ts';

type Daemon = TestDaemon;

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
let running: Daemon[];

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-tasks-'));
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

const boot = async (): Promise<Daemon> => {
    const daemon = await bootTestDaemon({ home, store, clock });
    running.push(daemon);
    return daemon;
};

const verb = runVerb;

/* Opens a child with a task and answers its id and the id of the task. */
const delegate = async (daemon: Daemon, title: string, prompt: string, chat = true): Promise<{ childId: string; taskId: string }> => {
    const [line] = await verb(daemon, 'chat-lead', 'agent', ['claude', ...(chat ? ['--chat'] : []), '--task', title, '--prompt', prompt]);
    const fields = line!.split('\t');
    expect(fields).toHaveLength(6);
    return { childId: fields[0]!, taskId: fields[5]! };
};

/* Opens a team of terminal roles with --task, which settle only when each calls done, and answers each role's node and task. */
const delegateTeam = async (daemon: Daemon, titles: readonly string[]): Promise<Array<{ childId: string; taskId: string }>> => {
    const roles = titles.map((title) => ({ title, prompt: `work on ${title}`, provider: 'claude' }));
    const lines = await verb(daemon, 'chat-lead', 'team', ['--label', 'Crew', '--task', '--roles', JSON.stringify(roles)]);
    expect(lines).toHaveLength(titles.length + 2);
    expect(lines.at(-1)).toBe(nextLine(true));
    return lines.slice(1, -1).map((line) => {
        const fields = line.split('\t');
        return { childId: fields[0]!, taskId: fields[6]! };
    });
};

/* A terminal child reporting back, and the outbox done with whatever that owed. */
const report = async (daemon: Daemon, child: { childId: string; taskId: string }, result: string): Promise<void> => {
    expect(await verb(daemon, child.childId, 'done', ['--result', result])).toEqual([`done\t${child.taskId}\tchat-lead`]);
    await daemon.until(() => daemon.outbox.list().some((entry) => entry.kind === 'wake-parent' && entry.payload.taskId === child.taskId));
    await daemon.worker.settled();
};

/* The lead with a finished turn behind it, idle and stored, so a wake finds it after a restart too. */
const leadIdle = async (daemon: Daemon): Promise<void> => {
    await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
    await daemon.chats.send('chat-lead', 'plan the work');
    await daemon.until(() => turnsOf(daemon, 'chat-lead').some((turn) => turn.state === 'done'));
};

const turnsOf = (daemon: Daemon, chatId: string): ChatTurnItem[] =>
    (daemon.chats.get(chatId)?.thread.list() ?? []).filter((item): item is ChatTurnItem => item.kind === 'turn');

const wakeTurns = (daemon: Daemon): ChatTurnItem[] => turnsOf(daemon, 'chat-lead').filter((turn) => turn.taskIds !== undefined);

const leadItems = (daemon: Daemon): ChatItem[] => daemon.chats.get('chat-lead')?.thread.list() ?? [];

/* The lead in the middle of a turn, as it is while it runs the verbs. */
const leadWorking = async (daemon: Daemon): Promise<void> => {
    await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
    await daemon.chats.send('chat-lead', 'slow');
    await daemon.until(() => daemon.chats.get('chat-lead')?.info.agentSessionId !== null);
};

/* Settled and owed: the wake entries are in the outbox, which is where a restart finds them. */
const settledTasks = (daemon: Daemon, count: number) => (): boolean =>
    daemon.tasks.ofParent('chat-lead').filter((task) => task.status !== 'open').length === count &&
    daemon.outbox.list().filter((entry) => entry.kind === 'wake-parent').length === count;

describe('a task wakes the chat that gave it', () => {
    test('three children that settle while the lead works give it exactly one new turn with three results, without polling', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadWorking(daemon);

        const children = [
            await delegate(daemon, 'Lexer', 'fix the tokenizer'),
            await delegate(daemon, 'Parser', 'fix the parser'),
            await delegate(daemon, 'Docs', 'write the docs')
        ];
        await daemon.until(settledTasks(daemon, 3));
        await daemon.worker.settled();

        // Settled, owed, and waiting for the lead's turn rather than being tried on a clock.
        expect(daemon.tasks.ofParent('chat-lead').map((task) => [task.status, task.wake, task.result?.source])).toEqual([
            ['done', 'pending', 'turn'],
            ['done', 'pending', 'turn'],
            ['done', 'pending', 'turn']
        ]);
        expect(daemon.outbox.list().map((entry) => entry.kind)).toEqual(['wake-parent', 'wake-parent', 'wake-parent']);
        expect(wakeTurns(daemon)).toEqual([]);

        // The lead ends its turn.
        daemon.chats.cancel('chat-lead');
        await daemon.until(() => wakeTurns(daemon).some((turn) => turn.state === 'done'));
        await daemon.worker.settled();

        const [wake] = wakeTurns(daemon);
        expect(wakeTurns(daemon)).toHaveLength(1);
        expect(wake).toMatchObject({ origin: 'agent', label: 'Lexer, Parser, Docs', taskIds: children.map((child) => child.taskId) });
        const items = leadItems(daemon);
        // No message of a person was made up: a note says what woke it, and the CLI alone got the results.
        expect(items.filter((item) => item.kind === 'user')).toHaveLength(1);
        expect(items.find((item) => item.kind === 'note' && item.turnId === wake!.id)).toMatchObject({ text: 'Woken by 3 finished tasks' });
        const answer = items.find((item) => item.kind === 'assistant' && item.turnId === wake!.id);
        expect(answer?.kind === 'assistant' ? answer.text : '').toStartWith('echo: 3 tasks you gave have settled. Their results:');
        for (const child of children) {
            expect(answer?.kind === 'assistant' ? answer.text : '').toContain(`(node ${child.childId}, task ${child.taskId}): done`);
            expect(answer?.kind === 'assistant' ? answer.text : '').toContain('echo: fix the');
        }
        expect(daemon.tasks.ofParent('chat-lead').map((task) => task.wake)).toEqual(['sent', 'sent', 'sent']);
        expect(daemon.outbox.list()).toEqual([]);

        // Every child stands in the lead's thread as a sub-agent row a panel can open.
        const rows = items.filter((item): item is ChatSubagentItem => item.kind === 'subagent');
        expect(rows.map((row) => [row.origin, row.childId, row.status, row.description])).toEqual(
            children.map((child, index) => ['ruimte', child.childId, 'done', ['Lexer', 'Parser', 'Docs'][index]])
        );
        const page = await daemon.chats.subagent('client-1', { chatId: 'chat-lead', toolUseId: rows[0]!.toolUseId });
        expect(page.items.some((item) => item.kind === 'assistant' && item.text.startsWith('echo: fix the tokenizer'))).toBe(true);
        expect(page.live).toBe(false);

        // What `tasks` shows the lead: nothing current once the wake went, and the history under --all.
        expect((await verb(daemon, 'chat-lead', 'task', ['list'])).map((line) => line.split('\t')[0])).toEqual(['note']);
        expect((await verb(daemon, 'chat-lead', 'task', ['list', '--all'])).map((line) => line.split('\t').slice(0, 4).join('\t'))).toEqual(
            children.map((child) => `task\t${child.taskId}\tgave\tdone`)
        );
    });

    test('a child that settles while the lead is idle wakes it at once', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadWorking(daemon);
        const child = await delegate(daemon, 'Lexer', 'fix the tokenizer');
        daemon.chats.cancel('chat-lead');
        await daemon.until(() => wakeTurns(daemon).some((turn) => turn.state === 'done'));
        expect(wakeTurns(daemon).map((turn) => turn.taskIds)).toEqual([[child.taskId]]);
    });

    test('a terminal child that exits without done fails its task, and the lead is woken with that', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        const child = await delegate(daemon, 'Lexer', 'fix the tokenizer', false);
        await daemon.worker.settled();
        const pty = daemon.adapter.forSession(child.childId);
        // The terminal was told how to report back, on the line its CLI starts with.
        expect(pty.input[0]).toContain('ruimte-context done --result');

        pty.exit(0);
        await daemon.until(() => wakeTurns(daemon).some((turn) => turn.state === 'done'));

        expect(daemon.tasks.get(child.taskId)).toMatchObject({
            status: 'failed',
            wake: 'sent',
            result: { source: 'exit', text: 'It ended without a result: a terminal reports back with ruimte-context done.' }
        });
        expect(daemon.alerts).toEqual([`${child.childId}\tTask failed: Lexer\tIt ended without a result: a terminal reports back with ruimte-context done.`]);
        const row = leadItems(daemon).find((item): item is ChatSubagentItem => item.kind === 'subagent');
        expect(row?.status).toBe('failed');
    });

    test('a terminal child that calls done settles its task with that result, and its exit afterwards changes nothing', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        const child = await delegate(daemon, 'Lexer', 'fix the tokenizer', false);
        await daemon.worker.settled();

        expect(await verb(daemon, child.childId, 'done', ['--result', 'Both bugs fixed'])).toEqual([`done\t${child.taskId}\tchat-lead`]);
        daemon.adapter.forSession(child.childId).exit(0);
        await daemon.until(() => wakeTurns(daemon).some((turn) => turn.state === 'done'));
        expect(daemon.tasks.get(child.taskId)).toMatchObject({ status: 'done', result: { source: 'done', text: 'Both bugs fixed' } });
        expect(daemon.alerts).toEqual([]);
    });

    test('a terminal agent is refused a task', async () => {
        const daemon = await boot();
        const [line] = await verb(daemon, 'term-lead', 'agent', ['claude', '--chat', '--task', 'Lexer', '--prompt', 'fix it']);
        expect(line).toStartWith('refused\tnot-a-chat-parent\t');
        expect(daemon.tasks.involving('term-lead')).toEqual([]);
    });

    test('a restart between a child settling and the lead waking still wakes the lead exactly once', async () => {
        const first = await boot();
        first.worker.start();
        await leadWorking(first);
        const child = await delegate(first, 'Lexer', 'fix the tokenizer');
        await first.until(settledTasks(first, 1));
        await first.worker.settled();
        expect(first.outbox.list().map((entry) => entry.kind)).toEqual(['wake-parent']);
        running.splice(running.indexOf(first), 1);
        await first.stop();

        const second = await boot();
        second.worker.start();
        // The lead's own turn is taken up again first; the wake waits for it and then goes out once.
        await second.chats.recoverInterrupted();
        await second.until(() => wakeTurns(second).some((turn) => turn.state === 'done'));
        await second.worker.settled();

        expect(wakeTurns(second).map((turn) => turn.taskIds)).toEqual([[child.taskId]]);
        const resumed = turnsOf(second, 'chat-lead').find((turn) => turn.origin !== 'agent');
        expect(resumed).toMatchObject({ state: 'done', attempt: 2 });
        expect(second.tasks.get(child.taskId)?.wake).toBe('sent');
        expect(second.outbox.list()).toEqual([]);
    });

    test('a child a person removes cancels its task, fails its row with a note and wakes nobody', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        // A question keeps the child's first turn open, so the task is still open when the node goes.
        const child = await delegate(daemon, 'Lexer', 'ask: which color');
        await daemon.until(() => daemon.chats.get(child.childId)?.info.activeTurnId !== null);
        // The start-agent handler checks the node is still placed after its create; removing it before that check lands would let the handler end the chat first.
        await daemon.worker.settled();

        await store.mutate(projectId, (current) => ({
            content: {
                ...current,
                views: current.views.map((view) =>
                    view.kind === 'canvas' ? { ...view, nodes: view.nodes.filter((node) => node.id !== child.childId), edges: [] } : view
                )
            },
            result: null
        }));
        await daemon.until(() => daemon.tasks.get(child.taskId)?.status === 'cancelled');
        await daemon.chats.kill(child.childId);
        await daemon.worker.settled();
        await daemon.until(() => leadItems(daemon).some((item) => item.kind === 'note' && item.level === 'warning'));

        expect(daemon.tasks.get(child.taskId)).toMatchObject({ status: 'cancelled', wake: 'none' });
        expect(leadItems(daemon).find((item) => item.kind === 'subagent')).toMatchObject({ status: 'failed', childId: child.childId });
        expect(wakeTurns(daemon)).toEqual([]);
        expect(daemon.outbox.list()).toEqual([]);
    });
});

describe('the tasks of one team call wake the lead together', () => {
    test('three roles that settle at different moments while the lead is idle give exactly one wake with three results', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadIdle(daemon);
        const roles = await delegateTeam(daemon, ['Lexer', 'Parser', 'Docs']);
        await daemon.worker.settled();
        const batchIds = new Set(roles.map((role) => daemon.tasks.get(role.taskId)?.batchId));
        expect(batchIds.size).toBe(1);
        expect([...batchIds][0]).toStartWith('batch-');

        await report(daemon, roles[0]!, 'Lexer fixed');
        await report(daemon, roles[1]!, 'Parser fixed');
        // Two results are in and the lead is idle, but the team is not complete, so nobody is woken.
        expect(wakeTurns(daemon)).toEqual([]);
        expect(daemon.tasks.ofParent('chat-lead').map((task) => task.wake)).toEqual(['pending', 'pending', 'pending']);

        await report(daemon, roles[2]!, 'Docs written');
        await daemon.until(() => wakeTurns(daemon).some((turn) => turn.state === 'done'));
        await daemon.worker.settled();

        expect(wakeTurns(daemon).map((turn) => turn.taskIds)).toEqual([roles.map((role) => role.taskId)]);
        const wake = wakeTurns(daemon)[0]!;
        const answer = leadItems(daemon).find((item) => item.kind === 'assistant' && item.turnId === wake.id);
        const text = answer?.kind === 'assistant' ? answer.text : '';
        expect(text).toStartWith('echo: 3 tasks you gave have settled. Their results:');
        expect(text).toContain('The tasks of one team call come in together, once every one of them has settled.');
        expect(text).not.toContain('still out');
        expect(daemon.tasks.ofParent('chat-lead').map((task) => task.wake)).toEqual(['sent', 'sent', 'sent']);
        expect(daemon.outbox.list()).toEqual([]);
        const batchId = [...batchIds][0]!;
        expect((await verb(daemon, 'chat-lead', 'task', ['list', '--all'])).map((line) => line.split('\t').at(-1))).toEqual([batchId, batchId, batchId]);
    });

    test('a role that fails and a role a person removes still complete the team', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadIdle(daemon);
        const [done, failed, removed] = await delegateTeam(daemon, ['Lexer', 'Parser', 'Docs']);
        await daemon.worker.settled();

        await report(daemon, done!, 'Lexer fixed');
        daemon.adapter.forSession(failed!.childId).exit(0);
        await daemon.until(() => daemon.tasks.get(failed!.taskId)?.status === 'failed');
        await daemon.worker.settled();
        expect(wakeTurns(daemon)).toEqual([]);

        // The last role goes last, cancelled, which owes no wake of its own: the held results go out anyway.
        await store.mutate(projectId, (current) => ({
            content: {
                ...current,
                views: current.views.map((view) =>
                    view.kind === 'canvas'
                        ? {
                              ...view,
                              nodes: view.nodes.filter((node) => node.id !== removed!.childId),
                              edges: view.edges.filter((edge) => edge.to !== removed!.childId)
                          }
                        : view
                )
            },
            result: null
        }));
        await daemon.until(() => wakeTurns(daemon).some((turn) => turn.state === 'done'));
        await daemon.worker.settled();

        expect(daemon.tasks.get(removed!.taskId)).toMatchObject({ status: 'cancelled', wake: 'none' });
        expect(wakeTurns(daemon).map((turn) => turn.taskIds)).toEqual([[done!.taskId, failed!.taskId]]);
        expect(daemon.tasks.get(failed!.taskId)?.wake).toBe('sent');
    });

    test('a single agent task wakes the lead on its own beside an open team, and the team comes later in one wake', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadIdle(daemon);
        const [first, second] = await delegateTeam(daemon, ['Lexer', 'Parser']);
        await daemon.worker.settled();
        await report(daemon, first!, 'Lexer fixed');

        const single = await delegate(daemon, 'Review', 'review the plan', false);
        await daemon.worker.settled();
        await report(daemon, single, 'Looks fine');
        await daemon.until(() => wakeTurns(daemon).some((turn) => turn.state === 'done'));
        await daemon.worker.settled();

        expect(wakeTurns(daemon).map((turn) => turn.taskIds)).toEqual([[single.taskId]]);
        const wake = wakeTurns(daemon)[0]!;
        const answer = leadItems(daemon).find((item) => item.kind === 'assistant' && item.turnId === wake.id);
        const text = answer?.kind === 'assistant' ? answer.text : '';
        expect(text).toContain("A team you gave is still out: you are woken with all of a team's results once its last task settles.");
        expect(text).not.toContain('Lexer fixed');
        expect(daemon.tasks.get(first!.taskId)?.wake).toBe('pending');

        await report(daemon, second!, 'Parser fixed');
        await daemon.until(() => wakeTurns(daemon).filter((turn) => turn.state === 'done').length === 2);
        await daemon.worker.settled();

        expect(wakeTurns(daemon).map((turn) => turn.taskIds)).toEqual([[single.taskId], [first!.taskId, second!.taskId]]);
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('a restart in the middle of a team keeps its results together', async () => {
        const first = await boot();
        first.worker.start();
        await leadIdle(first);
        const roles = await delegateTeam(first, ['Lexer', 'Parser']);
        await first.worker.settled();
        await report(first, roles[0]!, 'Lexer fixed');
        expect(wakeTurns(first)).toEqual([]);
        running.splice(running.indexOf(first), 1);
        await first.stop();

        const second = await boot();
        second.worker.start();
        await second.worker.settled();
        expect(second.tasks.get(roles[0]!.taskId)).toMatchObject({ status: 'done', wake: 'pending' });
        expect(wakeTurns(second)).toEqual([]);

        await report(second, roles[1]!, 'Parser fixed');
        await second.until(() => wakeTurns(second).some((turn) => turn.state === 'done'));
        await second.worker.settled();

        // Read back from disk, two tasks made at one moment on the manual clock have no order between them.
        expect(wakeTurns(second).map((turn) => [...(turn.taskIds ?? [])].sort())).toEqual([roles.map((role) => role.taskId).sort()]);
        expect(second.outbox.list()).toEqual([]);
    });
});
