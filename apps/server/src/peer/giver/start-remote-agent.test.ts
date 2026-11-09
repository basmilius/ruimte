import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodedError } from '@adecore/agents';
import { ManualClock } from '@adecore/agents/testing';
import { MAX_RESULT_LENGTH } from '../../canvas/tasks.ts';
import { projectOverlays } from '../../projects/overlays.ts';
import { projectLinks } from '../../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../../projects/project-store.ts';
import { bootTestDaemon, invokeTool, type TestDaemon } from '../../testing/test-daemon.ts';
import type { PeerLink } from './peer-connection.ts';
import { leadContent } from './test-helpers.ts';

const MACHINE = 'machine-b';
const STARTED = { cwd: '/studio/work', branch: null };
const STILL_OPEN = { status: 'open', result: null, bundle: null };

let root: string;
let home: string;
let folder: string;
let store: ProjectStore;
let projectId: string;
let clock: ManualClock;
let daemon: TestDaemon;
let open: PeerLink | null;
let requests: Array<{ type: string; payload: unknown }>;
let answer: (type: string, payload: unknown) => unknown;
let owed: string[];
let linked: boolean;

function fakeLink(): PeerLink {
    return {
        request: async <T>(type: string, payload: unknown): Promise<T> => {
            requests.push({ type, payload });
            return (await answer(type, payload)) as T;
        },
        onFrame: () => () => undefined,
        onLost: () => undefined,
        close: () => undefined
    };
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-remote-agent-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    store = new ProjectStore(home, projectLinks(), projectOverlays(home));
    const opened = await store.openProject({ folder });
    projectId = opened.summary.projectId;
    await store.save(projectId, opened.document.rev, leadContent());
    store.release(projectId);
    clock = new ManualClock();
    open = null;
    requests = [];
    owed = [];
    linked = true;
    answer = (type) => (type === 'peer.result' ? STILL_OPEN : STARTED);
    daemon = await bootTestDaemon({
        home,
        store,
        clock,
        remote: {
            machines: () => (linked ? [{ machineId: MACHINE, label: 'Studio', remoteProjectId: 'remote-project', ready: true }] : []),
            connections: { link: () => open },
            reconnect: { owe: async (machineId) => void owed.push(machineId) }
        }
    });
    daemon.worker.start();
});

afterEach(async () => {
    await daemon.stop();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

const give = (input: Record<string, unknown> = {}): Promise<string[]> =>
    invokeTool(daemon, 'chat-lead', 'agent_start', { cli: 'claude', task: 'Fix the lexer', prompt: 'Fix it', machine: 'Studio', ...input });

describe('agent --machine', () => {
    test('refuses a machine the project is not linked to, and lists the ones it is', async () => {
        const [first] = await invokeTool(daemon, 'chat-lead', 'agent_start', { cli: 'claude', task: 'T', prompt: 'P', machine: 'Nowhere' });
        expect(first).toStartWith('refused\tmachine-not-linked\t');
        linked = false;
        const [second, ...lines] = await give();
        expect(second).toStartWith('refused\tmachine-not-linked\t');
        expect(lines.join('\n')).toContain('No machine is linked');
        expect(daemon.tasks.all()).toHaveLength(0);
    });

    test("needs no CLI here for an agent on another machine, and fails the task with that machine's word when it has none", async () => {
        await daemon.stop();
        daemon = await bootTestDaemon({
            home,
            store,
            clock,
            installed: [],
            remote: {
                machines: () => [{ machineId: MACHINE, label: 'Studio', remoteProjectId: 'remote-project', ready: true }],
                connections: { link: () => open },
                reconnect: { owe: async (machineId) => void owed.push(machineId) }
            }
        });
        daemon.worker.start();
        open = fakeLink();
        answer = (type) => {
            if (type === 'peer.taskStart') {
                throw new CodedError('cli-not-installed', 'Claude Code is not installed on this machine');
            }
            return STILL_OPEN;
        };
        const [line] = await give();
        expect(line).not.toStartWith('refused');
        const [team] = await invokeTool(daemon, 'chat-lead', 'agent_team', {
            label: 'Crew',
            task: true,
            machine: 'Studio',
            roles: JSON.stringify([{ title: 'Role', prompt: 'Do it', provider: 'claude' }])
        });
        expect(team).not.toStartWith('refused');
        await daemon.worker.settled();
        expect(daemon.tasks.get(line!.split('\t')[5]!)).toMatchObject({
            status: 'failed',
            result: { text: 'The task could not be started on the other machine: Claude Code is not installed on this machine' }
        });
    });

    test('a task is not given to an agent that runs on another machine', async () => {
        const [line] = await give();
        const nodeId = line!.split('\t')[0]!;
        const [first] = await invokeTool(daemon, 'chat-lead', 'task_new', { id: nodeId, prompt: 'and one more thing' });
        expect(first).toStartWith('refused\ttask-on-other-machine\t');
        expect(daemon.tasks.involving(nodeId)).toHaveLength(1);
    });

    test('refuses what means nothing on another machine', async () => {
        const cases: Array<[Record<string, unknown>, string]> = [
            [{ cwd: folder }, 'machine-and-cwd'],
            [{ reads: 'chat-lead' }, 'machine-and-reads'],
            [{ model: 'x' }, 'machine-and-model'],
            [{ effort: 'high' }, 'machine-and-effort']
        ];
        for (const [flags, code] of cases) {
            const [first] = await give(flags);
            expect(first).toStartWith(`refused\t${code}\t`);
        }
        const [noTask] = await invokeTool(daemon, 'chat-lead', 'agent_start', { cli: 'claude', prompt: 'P', machine: 'Studio' });
        expect(noTask).toStartWith('refused\tmachine-needs-task\t');
        expect(await store.read(projectId).then((doc) => doc.views.flatMap((view) => (view.kind === 'canvas' ? view.nodes : [])))).toHaveLength(1);
    });

    test('writes the node bound to the machine, the task with it, and no line to the node', async () => {
        const [line] = await give();
        const [nodeId, kind, , provider, edge, taskId] = line!.split('\t');
        expect([kind, provider, edge]).toEqual(['chat', 'claude', '-']);
        expect(store.remote.machineOf(projectId, nodeId!)).toBe(MACHINE);
        const task = daemon.tasks.get(taskId!)!;
        expect(task).toMatchObject({ machine: MACHINE, parentId: 'chat-lead', childId: nodeId, status: 'open', title: 'Fix the lexer' });
        const doc = await store.read(projectId);
        expect(JSON.stringify(doc)).not.toContain(MACHINE);
        expect(doc.views.flatMap((view) => (view.kind === 'canvas' ? view.edges : []))).toEqual([]);
        expect(daemon.lineage.madeBy(nodeId!)).toBe('chat-lead');
    });

    test('waits while the machine is away, owes the reconnect, and starts once the link opens', async () => {
        const [line] = await give({ mode: 'supervised' });
        const [nodeId, , , , , taskId] = line!.split('\t');
        await daemon.worker.settled();
        expect(requests).toEqual([]);
        expect(owed).toContain(MACHINE);
        expect(daemon.outbox.list().map((entry) => entry.kind)).toEqual(['start-remote-agent']);

        open = fakeLink();
        daemon.worker.wake(nodeId!);
        await daemon.worker.settled();

        expect(requests.filter((request) => request.type === 'peer.taskStart')).toHaveLength(1);
        expect(requests[0]).toMatchObject({
            type: 'peer.taskStart',
            payload: {
                projectId: 'remote-project',
                nodeId,
                parentId: 'chat-lead',
                title: 'Fix the lexer',
                prompt: 'Fix it',
                provider: 'claude',
                mode: 'supervised',
                depth: 1
            }
        });
        // Started is not done: the entry that takes the result in stays, and the task is still open.
        expect(daemon.outbox.list().map((entry) => entry.kind)).toEqual(['take-remote-result']);
        expect(daemon.tasks.get(taskId!)?.status).toBe('open');
    });

    test('fails the task when the machine refuses it, and wakes the parent with why', async () => {
        open = fakeLink();
        answer = () => {
            throw new CodedError('depth-limit', 'An agent from another machine may sit at depth 2 here, and this one would be at 3');
        };
        const [line] = await give();
        const taskId = line!.split('\t')[5]!;
        await daemon.worker.settled();
        const task = daemon.tasks.get(taskId)!;
        expect(task.status).toBe('failed');
        expect(task.result?.text).toContain('may sit at depth 2');
        expect(daemon.outbox.list().filter((entry) => entry.kind === 'start-remote-agent')).toEqual([]);
    });

    test('a team larger than the places the machine has starts the rest as places free up, and fails none', async () => {
        open = fakeLink();
        const running = new Set<string>();
        const settled = new Set<string>();
        answer = (type, payload) => {
            const { nodeId } = payload as { nodeId: string };
            if (type === 'peer.taskStart') {
                if (running.size >= 4) {
                    throw new CodedError('peer-busy', 'This machine already runs 4 tasks for that machine. Try again when one is done');
                }
                running.add(nodeId);
                return STARTED;
            }
            return settled.has(nodeId) ? { status: 'done', result: { text: `${nodeId} done`, source: 'turn', at: 5 }, bundle: null } : STILL_OPEN;
        };
        const roles = Array.from({ length: 6 }, (_, i) => ({ title: `Role ${i}`, prompt: `Do part ${i}`, provider: 'claude' }));
        const lines = await invokeTool(daemon, 'chat-lead', 'agent_team', { label: 'Crew', task: true, machine: 'Studio', roles: JSON.stringify(roles) });
        const ids = lines.slice(1, 7).map((line) => line.split('\t')[0]!);
        await daemon.worker.settled();

        const started = (): number =>
            requests.filter((request) => request.type === 'peer.taskStart' && running.has((request.payload as { nodeId: string }).nodeId)).length;
        expect(started()).toBe(4);
        expect(daemon.outbox.list().filter((entry) => entry.kind === 'start-remote-agent')).toHaveLength(2);
        expect(daemon.tasks.ofParent('chat-lead').filter((task) => task.status === 'failed')).toEqual([]);

        // The machine says one settled: it frees a place, and one of the two that waited goes.
        const first = ids.find((id) => running.has(id))!;
        settled.add(first);
        running.delete(first);
        daemon.remoteTasks.peerSettled(MACHINE, first);
        await daemon.worker.settled();
        expect(daemon.outbox.list().filter((entry) => entry.kind === 'start-remote-agent')).toHaveLength(1);

        const second = ids.find((id) => running.has(id) && id !== first)!;
        settled.add(second);
        running.delete(second);
        daemon.remoteTasks.peerSettled(MACHINE, second);
        await daemon.worker.settled();
        expect(daemon.outbox.list().filter((entry) => entry.kind === 'start-remote-agent')).toEqual([]);
        expect(daemon.tasks.ofParent('chat-lead').filter((task) => task.status === 'failed')).toEqual([]);
        expect(daemon.tasks.ofParent('chat-lead').filter((task) => task.status === 'done')).toHaveLength(2);
    });

    test('a result taken in whose acknowledgment was lost, and whose node then went, is acknowledged when the machine tells of it again', async () => {
        open = fakeLink();
        const [line] = await give();
        const nodeId = line!.split('\t')[0]!;
        const taskId = line!.split('\t')[5]!;
        await daemon.worker.settled();
        answer = (type, payload) => {
            if (type !== 'peer.result') {
                return STARTED;
            }
            if ((payload as { ack?: boolean }).ack === true) {
                open = null;
                throw new Error('The channel closed');
            }
            return { status: 'done', result: { text: 'Fixed', source: 'turn', at: 5 }, bundle: null };
        };
        daemon.worker.wake(nodeId);
        await daemon.worker.settled();
        expect(daemon.tasks.get(taskId)).toMatchObject({ status: 'done' });
        // The node goes while the link is down, and the entry with it.
        for (const entry of daemon.outbox.list().filter((candidate) => candidate.target === nodeId)) {
            await daemon.outbox.remove(entry.id);
        }

        open = fakeLink();
        requests = [];
        answer = () => ({});
        daemon.remoteTasks.peerSettled(MACHINE, nodeId);
        await Promise.resolve();
        expect(requests).toEqual([{ type: 'peer.result', payload: { nodeId, ack: true } }]);
    });

    test('a task a machine had no place for starts when the link opens again, with nothing on a clock', async () => {
        open = fakeLink();
        let busy = true;
        answer = (type) => {
            if (type === 'peer.taskStart' && busy) {
                throw new CodedError('peer-busy', 'This machine already runs 4 tasks for that machine');
            }
            return type === 'peer.result' ? STILL_OPEN : STARTED;
        };
        const [line] = await give();
        const nodeId = line!.split('\t')[0]!;
        await daemon.worker.settled();
        expect(daemon.outbox.list().map((entry) => entry.kind)).toEqual(['start-remote-agent']);
        expect(daemon.outbox.list()[0]).toMatchObject({ attempts: 0 });
        clock.advance(8 * 24 * 60 * 60 * 1000);
        await daemon.worker.settled();
        expect(requests.filter((request) => request.type === 'peer.taskStart')).toHaveLength(1);

        busy = false;
        daemon.worker.wake(nodeId);
        await daemon.worker.settled();
        expect(daemon.outbox.list().map((entry) => entry.kind)).toEqual(['take-remote-result']);
    });

    test('a machine that names a node it was given no task for wakes nothing', async () => {
        open = fakeLink();
        const [line] = await give();
        const nodeId = line!.split('\t')[0]!;
        await daemon.worker.settled();
        const woken: string[] = [];
        const wake = daemon.worker.wake.bind(daemon.worker);
        daemon.worker.wake = (target: string) => {
            woken.push(target);
            wake(target);
        };
        daemon.remoteTasks.peerSettled(MACHINE, 'chat-lead');
        daemon.remoteTasks.peerSettled('machine-c', nodeId);
        expect(woken).toEqual([]);
        daemon.remoteTasks.peerSettled(MACHINE, nodeId);
        expect(woken).toContain(nodeId);
    });

    test('a start that waits for a place runs once the result of another task is taken in, without the machine saying anything', async () => {
        open = fakeLink();
        let full = false;
        const finished = new Set<string>();
        answer = (type, payload) => {
            if (type === 'peer.taskStart') {
                if (full) {
                    throw new CodedError('peer-busy', 'This machine already runs 4 tasks for that machine');
                }
                full = true;
                return STARTED;
            }
            if ((payload as { ack?: boolean }).ack === true) {
                full = false;
            }
            return finished.has((payload as { nodeId: string }).nodeId)
                ? { status: 'done', result: { text: 'Fixed', source: 'turn', at: 1 }, bundle: null }
                : STILL_OPEN;
        };
        const [first] = await give();
        const [second] = await give();
        const firstNode = first!.split('\t')[0]!;
        const secondNode = second!.split('\t')[0]!;
        await daemon.worker.settled();
        expect(daemon.outbox.list().map((entry) => [entry.kind, entry.target])).toEqual([
            ['take-remote-result', firstNode],
            ['start-remote-agent', secondNode]
        ]);

        finished.add(firstNode);
        daemon.worker.wake(firstNode);
        await daemon.worker.settled();
        expect(daemon.outbox.list().map((entry) => [entry.kind, entry.target])).toEqual([['take-remote-result', secondNode]]);
    });

    test('a machine out of reach for good fails what was owed to it, with a line each, and opens no new window for the stop of what may run there', async () => {
        open = fakeLink();
        const [started] = await give();
        const startedTask = started!.split('\t')[5]!;
        await daemon.worker.settled();
        open = null;
        const [waiting] = await give();
        const waitingTask = waiting!.split('\t')[5]!;
        await daemon.worker.settled();
        expect(
            daemon.outbox
                .list()
                .map((entry) => entry.kind)
                .sort()
        ).toEqual(['start-remote-agent', 'take-remote-result']);
        owed = [];

        await daemon.remoteTasks.giveUp(MACHINE);
        // With no link open they are let go, and neither asks for a reconnect.
        await daemon.worker.settled();
        expect(daemon.tasks.get(waitingTask)).toMatchObject({ status: 'failed', result: { text: expect.stringContaining('never started there') } });
        expect(daemon.tasks.get(startedTask)).toMatchObject({
            status: 'failed',
            result: { text: expect.stringContaining('may still run until a person stops it on that machine') }
        });
        expect(daemon.outbox.list()).toEqual([]);
        expect(owed).toEqual([]);
    });

    test('a machine that refuses this one fails what was owed to it at once, with the reason in each line', async () => {
        open = fakeLink();
        const [started] = await give();
        const startedTask = started!.split('\t')[5]!;
        await daemon.worker.settled();
        open = null;
        const [waiting] = await give();
        const waitingTask = waiting!.split('\t')[5]!;
        await daemon.worker.settled();

        await daemon.remoteTasks.giveUp(MACHINE, 'it takes no statement from this machine');
        await daemon.worker.settled();
        expect(daemon.tasks.get(waitingTask)).toMatchObject({
            status: 'failed',
            result: { text: 'The other machine refused this one (it takes no statement from this machine), so this task was never started there.' }
        });
        expect(daemon.tasks.get(startedTask)).toMatchObject({
            status: 'failed',
            result: { text: expect.stringContaining('The other machine refused this one (it takes no statement from this machine), so what became') }
        });
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('the stops a machine out of reach for good leaves are asked over a link that happens to be open, for an agent that started and for a start that may have', async () => {
        open = fakeLink();
        let busy = false;
        answer = (type) => {
            if (type === 'peer.taskStart' && busy) {
                throw new CodedError('peer-busy', 'This machine already runs 4 tasks for that machine');
            }
            return type === 'peer.result' ? STILL_OPEN : STARTED;
        };
        const [started] = await give();
        const startedNode = started!.split('\t')[0]!;
        await daemon.worker.settled();
        busy = true;
        const [waiting] = await give();
        const waitingNode = waiting!.split('\t')[0]!;
        await daemon.worker.settled();
        expect(daemon.outbox.list().map((entry) => [entry.kind, entry.target])).toEqual([
            ['take-remote-result', startedNode],
            ['start-remote-agent', waitingNode]
        ]);

        await daemon.remoteTasks.giveUp(MACHINE);
        await daemon.worker.settled();
        const stops = requests.filter((request) => request.type === 'peer.taskStop').map((request) => (request.payload as { nodeId: string }).nodeId);
        expect(stops.sort()).toEqual([startedNode, waitingNode].sort());
        expect(daemon.outbox.list()).toEqual([]);
    });

    function holdStart(): { asked: Promise<void>; end: ReturnType<typeof Promise.withResolvers<unknown>> } {
        const asked = Promise.withResolvers<void>();
        const end = Promise.withResolvers<unknown>();
        answer = (type) => {
            if (type === 'peer.taskStart') {
                asked.resolve();
                return end.promise;
            }
            return STILL_OPEN;
        };
        return { asked: asked.promise, end };
    }

    test('a start answered after the machine left its account owes that machine nothing, and its task says the agent may run there', async () => {
        open = fakeLink();
        const start = holdStart();
        const [line] = await give();
        await start.asked;
        await daemon.remoteTasks.leave();
        open = null;
        start.end.resolve(STARTED);
        await daemon.worker.settled();

        expect(daemon.outbox.list()).toEqual([]);
        expect(owed).toEqual([]);
        expect(daemon.tasks.get(line!.split('\t')[5]!)).toMatchObject({
            status: 'failed',
            result: { text: expect.stringContaining('may still run until a person stops it on that machine') }
        });
    });

    test('a start whose channel closes after the machine left its account owes that machine nothing', async () => {
        open = fakeLink();
        const start = holdStart();
        await give();
        await start.asked;
        await daemon.remoteTasks.leave();
        open = null;
        start.end.reject(new Error('The channel closed'));
        await daemon.worker.settled();

        expect(daemon.outbox.list()).toEqual([]);
        expect(owed).toEqual([]);
    });

    test('a start the machine refuses after this one left its account owes it nothing', async () => {
        open = fakeLink();
        const start = holdStart();
        await give();
        await start.asked;
        await daemon.remoteTasks.leave();
        start.end.reject(new CodedError('peer-busy', 'This machine already runs 4 tasks for that machine'));
        await daemon.worker.settled();

        expect(daemon.outbox.list()).toEqual([]);
        expect(owed).toEqual([]);
    });

    test('a report that comes back after the machine left its account is not taken in and owes nothing', async () => {
        open = fakeLink();
        const [line] = await give();
        const nodeId = line!.split('\t')[0]!;
        await daemon.worker.settled();
        const asked = Promise.withResolvers<void>();
        const report = Promise.withResolvers<unknown>();
        answer = (type, payload) => {
            if (type === 'peer.result' && (payload as { ack?: boolean }).ack !== true) {
                asked.resolve();
                return report.promise;
            }
            return {};
        };
        daemon.worker.wake(nodeId);
        await asked.promise;
        await daemon.remoteTasks.leave();
        open = null;
        report.resolve({ status: 'done', result: { text: 'Fixed', source: 'done', at: 1 }, bundle: null });
        await daemon.worker.settled();

        expect(daemon.outbox.list()).toEqual([]);
        expect(owed).toEqual([]);
        expect(requests.filter((request) => (request.payload as { ack?: boolean }).ack === true)).toEqual([]);
        expect(daemon.tasks.get(line!.split('\t')[5]!)?.result?.text).toContain('This machine left its account');
    });

    test('a once stop whose link drops mid-request is let go and owes no reconnect', async () => {
        open = fakeLink();
        const [started] = await give();
        await daemon.worker.settled();
        answer = (type) => {
            if (type === 'peer.taskStop') {
                open = null;
                throw new Error('The channel closed');
            }
            return STILL_OPEN;
        };
        owed = [];
        await daemon.remoteTasks.giveUp(MACHINE);
        await daemon.worker.settled();
        expect(requests.some((request) => request.type === 'peer.taskStop')).toBe(true);
        expect(owed).toEqual([]);
        expect(daemon.outbox.list()).toEqual([]);
        expect(daemon.tasks.get(started!.split('\t')[5]!)?.status).toBe('failed');
    });

    test('a CLI the machine will not run for another machine fails the task for good, with the words of the machine', async () => {
        open = fakeLink();
        answer = () => {
            throw new CodedError('peer-provider-unsupported', 'Codex cannot run a task from another machine here');
        };
        const [line] = await give();
        const taskId = line!.split('\t')[5]!;
        await daemon.worker.settled();
        expect(daemon.tasks.get(taskId)).toMatchObject({ status: 'failed', result: { text: expect.stringContaining('Codex cannot run a task') } });
        expect(daemon.outbox.list().filter((entry) => entry.kind === 'start-remote-agent')).toEqual([]);
    });

    test('a task stopped before it started is dropped without asking the machine', async () => {
        const [line] = await give();
        const nodeId = line!.split('\t')[0]!;
        await daemon.worker.settled();
        await daemon.endChildren.stopNode('chat-lead', 'a person stopped it');
        await daemon.worker.settled();
        open = fakeLink();
        daemon.worker.wake(nodeId);
        await daemon.worker.settled();
        expect(requests).toEqual([]);
        expect(daemon.outbox.list().filter((entry) => entry.kind.endsWith('remote-agent'))).toEqual([]);
        expect(daemon.tasks.get(line!.split('\t')[5]!)?.status).toBe('cancelled');
    });

    test('an agent that runs there is stopped there when its opener is stopped, and the stop waits for the link', async () => {
        open = fakeLink();
        const [line] = await give();
        const nodeId = line!.split('\t')[0]!;
        await daemon.worker.settled();
        expect(requests.map((request) => request.type)).toEqual(['peer.taskStart', 'peer.result']);

        open = null;
        await daemon.endChildren.stopNode('chat-lead', 'a person stopped it');
        await daemon.worker.settled();
        expect(daemon.outbox.list().map((entry) => entry.kind)).toEqual(['stop-remote-agent']);
        expect(requests).toHaveLength(2);

        open = fakeLink();
        daemon.worker.wake(`peer:${MACHINE}`);
        await daemon.worker.settled();
        expect(requests.at(-1)).toEqual({ type: 'peer.taskStop', payload: { nodeId } });
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('a team binds and starts every role on the machine with a task in its batch', async () => {
        open = fakeLink();
        const roles = [
            { title: 'Lexer', prompt: 'Fix the lexer', provider: 'claude' },
            { title: 'Parser', prompt: 'Fix the parser', provider: 'claude' }
        ];
        const lines = await invokeTool(daemon, 'chat-lead', 'agent_team', { label: 'Crew', task: true, machine: 'Studio', roles: JSON.stringify(roles) });
        const ids = lines.slice(1, 3).map((line) => line.split('\t')[0]!);
        await daemon.worker.settled();
        expect(ids.map((id) => store.remote.machineOf(projectId, id))).toEqual([MACHINE, MACHINE]);
        // The roles start side by side, so the requests leave in whichever order they were ready.
        const started = requests.filter((request) => request.type === 'peer.taskStart').map((request) => (request.payload as { title: string }).title);
        expect(started.toSorted()).toEqual(['Lexer', 'Parser']);
        const tasks = daemon.tasks.ofParent('chat-lead');
        expect(tasks.map((task) => [task.machine, task.batchId !== undefined])).toEqual([
            [MACHINE, true],
            [MACHINE, true]
        ]);
        expect(store.remote.machineOf(projectId, lines[0]!.split('\t')[0]!)).toBeNull();
    });

    test('keeps asking for the result while the task runs there, and settles it once, from what the machine says', async () => {
        open = fakeLink();
        const [line] = await give();
        const [nodeId, , , , , taskId] = line!.split('\t');
        await daemon.worker.settled();
        daemon.worker.wake(nodeId!);
        await daemon.worker.settled();
        expect(requests.at(-1)).toMatchObject({ type: 'peer.result', payload: { nodeId } });
        expect(daemon.tasks.get(taskId!)?.status).toBe('open');
        expect(daemon.outbox.list().map((entry) => entry.kind)).toEqual(['take-remote-result']);

        answer = (type) => (type === 'peer.result' ? { status: 'done', result: { text: 'All done', source: 'turn', at: 5 }, bundle: null } : {});
        daemon.worker.wake(nodeId!);
        await daemon.worker.settled();
        expect(daemon.tasks.get(taskId!)).toMatchObject({ status: 'done', result: { text: 'All done' } });
        expect(requests.at(-1)).toEqual({ type: 'peer.result', payload: { nodeId, ack: true } });
        expect(daemon.outbox.list()).toEqual([]);
        // Told again, it settles nothing a second time.
        expect(await daemon.wiring.coordinator.settleFromElsewhere(taskId!, { text: 'again', source: 'turn', at: 6 })).toBeNull();
    });

    test('a task a person stopped on the machine fails here once, with what happened there', async () => {
        open = fakeLink();
        const [line] = await give();
        const [nodeId, , , , , taskId] = line!.split('\t');
        await daemon.worker.settled();
        answer = (type) =>
            type === 'peer.result' ? { status: 'cancelled', result: { text: 'a person cleared this chat', source: 'exit', at: 5 }, bundle: null } : {};
        daemon.worker.wake(nodeId!);
        await daemon.worker.settled();
        expect(daemon.tasks.get(taskId!)).toMatchObject({
            status: 'failed',
            result: { text: 'The task was stopped on the other machine: a person cleared this chat.' }
        });
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('a task whose project the machine unlinked fails here with a line that says so', async () => {
        open = fakeLink();
        const [line] = await give();
        const [nodeId, , , , , taskId] = line!.split('\t');
        await daemon.worker.settled();
        answer = (type) => {
            if (type === 'peer.result') {
                throw new CodedError('peer-not-linked', 'No project here is linked to this machine');
            }
            return {};
        };
        daemon.worker.wake(nodeId!);
        await daemon.worker.settled();
        expect(daemon.tasks.get(taskId!)).toMatchObject({ status: 'failed', result: { text: expect.stringContaining('no longer links this project') } });
    });

    test('keeps a result only as long as every task result may be, and a refusal as short as a sentence', async () => {
        open = fakeLink();
        const [line] = await give();
        const [nodeId, , , , , taskId] = line!.split('\t');
        await daemon.worker.settled();
        answer = (type) => (type === 'peer.result' ? { status: 'done', result: { text: 'x'.repeat(500_000), source: 'turn', at: 5 }, bundle: null } : {});
        daemon.worker.wake(nodeId!);
        await daemon.worker.settled();
        const text = daemon.tasks.get(taskId!)!.result!.text;
        expect(text.length).toBeLessThanOrEqual(MAX_RESULT_LENGTH);
        expect(text).toEndWith('[The rest of the result was left out.]');

        answer = () => {
            throw new CodedError('depth-limit', 'y'.repeat(100_000));
        };
        const [second] = await give();
        await daemon.worker.settled();
        expect(daemon.tasks.get(second!.split('\t')[5]!)!.result!.text.length).toBeLessThan(1000);
    });

    test('a task that ended with the machine unreachable is acknowledged when the link is back, and a task that machine never knew fails', async () => {
        open = fakeLink();
        const [line] = await give();
        const [nodeId, , , , , taskId] = line!.split('\t');
        await daemon.worker.settled();
        // Settled here, but the daemon went down before the machine heard it had been taken in.
        await daemon.wiring.coordinator.settleFromElsewhere(taskId!, { text: 'Done', source: 'turn', at: 5 });
        open = null;
        daemon.worker.wake(nodeId!);
        await daemon.worker.settled();
        expect(daemon.outbox.list().map((entry) => entry.kind)).toEqual(['take-remote-result']);
        open = fakeLink();
        daemon.worker.wake(nodeId!);
        await daemon.worker.settled();
        expect(requests.at(-1)).toEqual({ type: 'peer.result', payload: { nodeId, ack: true } });
        expect(daemon.outbox.list()).toEqual([]);

        const [other] = await give();
        const otherTask = other!.split('\t')[5]!;
        await daemon.worker.settled();
        answer = (type) => (type === 'peer.result' ? { status: 'unknown', result: null, bundle: null } : {});
        daemon.worker.wake(other!.split('\t')[0]!);
        await daemon.worker.settled();
        expect(daemon.tasks.get(otherTask)).toMatchObject({ status: 'failed' });
    });
});
