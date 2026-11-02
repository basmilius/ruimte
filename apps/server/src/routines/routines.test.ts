import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zonedTime, type AgentRoutine, type ChatInfo, type Routine } from '@ruimte/contracts';
import { FakeWatch } from '@adecore/agents/testing';
import { OutboxStore, type RoutineRunEntry } from '../outbox/outbox.ts';
import { CommandApprovals } from '../sessions/command-approvals.ts';
import { RoutineAuthorStore, RoutineRunStore } from './routine-runs.ts';
import { RoutineStore } from './routine-store.ts';
import { digestOf, Routines, runMessage, type AgentRunStart, type CommandResult, type RunMessage } from './routines.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';

const ZONE = 'Europe/Amsterdam';
const PROJECT = 'p1';

let root: string;
let folder: string;
let home: string;
let now: number;
let outbox: OutboxStore;
let started: AgentRunStart[];
let continued: Array<{ chatId: string; message: RunMessage }>;
let chats: Map<string, Pick<ChatInfo, 'status'> & Partial<ChatInfo>>;
let commands: Array<{ resolve: (result: CommandResult) => void }>;
let delivered: string[];

const morning: AgentRoutine = {
    id: 'morning',
    kind: 'agent',
    title: 'Morning summary',
    prompt: 'Summarize what changed on main.',
    provider: 'claude',
    mode: 'supervised',
    schedule: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' },
    perRun: 'new',
    outputKey: 'morning-summary'
};

async function build(): Promise<{ routines: Routines; store: RoutineStore; runs: RoutineRunStore; approvals: CommandApprovals }> {
    outbox = new OutboxStore(home);
    await outbox.load();
    const runs = new RoutineRunStore(home);
    const authors = new RoutineAuthorStore(home);
    const approvals = new CommandApprovals(home);
    await Promise.all([runs.load(), authors.load(), approvals.load()]);
    const store = new RoutineStore({ folderOf: (projectId) => (projectId === PROJECT ? folder : null), seams: new FakeWatch() });
    const routines = new Routines({
        store,
        runs,
        authors,
        approvals,
        projects: () => Promise.resolve([{ projectId: PROJECT, name: 'ruimte', folder }]),
        outbox: {
            enqueue: async (projectId, target, work, notBefore) => {
                await outbox.put(projectId, target, work, now, notBefore ?? now);
            },
            list: () => outbox.list(),
            remove: (id) => outbox.remove(id)
        },
        agents: {
            start: async (start) => {
                started.push(start);
                chats.set(start.chatId, { status: 'running', usage: { turns: 0 } as ChatInfo['usage'] });
            },
            info: (chatId) => chats.get(chatId) as ChatInfo | undefined,
            starting: () => false,
            continueIn: async (chatId, message) => {
                if (chats.get(chatId)?.status === 'running') {
                    return false;
                }
                continued.push({ chatId, message });
                return true;
            },
            exists: async (chatId) => chats.has(chatId)
        },
        commands: {
            run: () =>
                new Promise((resolve) => {
                    commands.push({ resolve });
                })
        },
        output: {
            latest: () => null,
            byRun: () => new Map(),
            deliver: async ({ requestId }) => {
                delivered.push(requestId);
            }
        },
        machineId: 'machine',
        now: () => now,
        timeZone: () => ZONE,
        onChanged: () => undefined,
        log: () => undefined
    });
    return { routines, store, runs, approvals };
}

function owed(): RoutineRunEntry[] {
    return outbox.list().filter((entry): entry is RoutineRunEntry => entry.kind === 'routine-run');
}

/* What the worker does when the entry's time came: the handler runs, then the entry goes. */
async function fire(routines: Routines, entry: RoutineRunEntry): Promise<void> {
    await routines.handle(entry);
    await outbox.remove(entry.id);
}

const newHome = tempHomes('ruimte-routines-');

beforeEach(async () => {
    root = await newHome();
    folder = join(root, 'repo');
    home = join(root, 'home');
    await mkdir(folder, { recursive: true });
    // Monday 19 Oct 2026, 08:00 in Amsterdam.
    now = zonedTime(2026, 10, 19, 8, 0, ZONE);
    started = [];
    continued = [];
    chats = new Map();
    commands = [];
    delivered = [];
});

describe('the clock', () => {
    test('a person who saves a routine approves it and owes its next time', async () => {
        const { routines } = await build();
        await routines.save(PROJECT, 0, morning, false);
        const [entry] = owed();
        expect(entry?.payload.due).toBe(zonedTime(2026, 10, 19, 9, 0, ZONE));
        expect(entry?.notBefore).toBe(entry!.payload.due);
        const { routines: listed } = await routines.list(PROJECT);
        expect(listed[0]?.approved).toBe(true);
        expect(listed[0]?.next).toBe(entry!.payload.due);
    });

    test('a run on time starts the agent with where its result goes, then owes the next weekday', async () => {
        const { routines, runs } = await build();
        await routines.save(PROJECT, 0, morning, false);
        now = zonedTime(2026, 10, 19, 9, 0, ZONE);
        await fire(routines, owed()[0]!);
        expect(started).toHaveLength(1);
        // The person's prompt is the message; Ruimte's instructions ride beside it.
        expect(started[0]?.prompt).toBe(morning.prompt);
        expect(started[0]?.brief).toContain('artifact_publish --key morning-summary');
        // The chat shows the published report, so the reply only sums it up.
        expect(started[0]?.brief).toContain('does not repeat its content or copy its tables');
        const [run] = runs.of(PROJECT, 'morning');
        expect(run?.kind).toBe('scheduled');
        expect(run?.chatId).toBe(started[0]!.chatId);
        expect(owed().map((entry) => entry.payload.due)).toEqual([zonedTime(2026, 10, 20, 9, 0, ZONE)]);
    });

    test('a machine that slept through three times runs once on wake and notes what it missed', async () => {
        const { routines, runs } = await build();
        await routines.save(PROJECT, 0, morning, false);
        // Thursday 22 Oct 10:12: Monday through Thursday passed while it slept.
        now = zonedTime(2026, 10, 22, 10, 12, ZONE);
        await fire(routines, owed()[0]!);
        expect(started).toHaveLength(1);
        const [run] = runs.of(PROJECT, 'morning');
        expect(run?.kind).toBe('caught-up');
        expect(run?.missed).toHaveLength(4);
        expect(owed().map((entry) => entry.payload.due)).toEqual([zonedTime(2026, 10, 23, 9, 0, ZONE)]);
    });

    test('a chat that is idle before its first turn ended is still starting, and done once it ended one', async () => {
        const { routines, runs } = await build();
        await routines.save(PROJECT, 0, morning, false);
        const { runId } = await routines.runNow(PROJECT, 'morning');
        const chatId = started[0]!.chatId;
        const idle = (turns: number) => ({ status: 'idle', usage: { turns } }) as ChatInfo;
        await routines.observe(chatId, idle(0));
        expect(runs.get(runId!)?.state).toBe('starting');
        await routines.observe(chatId, { status: 'needs-you', usage: { turns: 0 } } as ChatInfo);
        expect(runs.get(runId!)?.state).toBe('needs-you');
        await routines.observe(chatId, idle(1));
        expect(runs.get(runId!)).toMatchObject({ state: 'done', waited: true });
    });

    test('a due run is skipped, never queued, while the previous one still waits on a person', async () => {
        const { routines, runs } = await build();
        await routines.save(PROJECT, 0, morning, false);
        now = zonedTime(2026, 10, 19, 9, 0, ZONE);
        await fire(routines, owed()[0]!);
        chats.set(started[0]!.chatId, { status: 'needs-you' });
        now = zonedTime(2026, 10, 20, 9, 0, ZONE);
        await fire(routines, owed()[0]!);
        expect(started).toHaveLength(1);
        const [latest] = runs.of(PROJECT, 'morning');
        expect(latest?.state).toBe('skipped');
        expect(latest?.skipped).toBe('overlap');
        expect(owed()).toHaveLength(1);
    });

    test('a run that continues the last chat says the prompt there, with the brief beside it', async () => {
        const { routines } = await build();
        await routines.save(PROJECT, 0, { ...morning, perRun: 'continue' }, false);
        now = zonedTime(2026, 10, 19, 9, 0, ZONE);
        await fire(routines, owed()[0]!);
        const chatId = started[0]!.chatId;
        chats.set(chatId, { status: 'idle', usage: { turns: 1 } as ChatInfo['usage'] });
        now = zonedTime(2026, 10, 20, 9, 0, ZONE);
        await fire(routines, owed()[0]!);
        expect(started).toHaveLength(1);
        expect(continued).toHaveLength(1);
        expect(continued[0]).toMatchObject({ chatId, message: { prompt: morning.prompt } });
        // ICU joins the date and the time with "at" on macOS and with a comma on Linux.
        expect(continued[0]?.message.brief).toMatch(/started at Tue, Oct 20(,| at) 09:00/);
    });

    test('pause owes nothing, and resume owes the next time from now, not the ones it skipped', async () => {
        const { routines } = await build();
        await routines.save(PROJECT, 0, morning, false);
        await routines.pause(PROJECT, 'morning');
        expect(owed()).toEqual([]);
        now = zonedTime(2026, 10, 21, 12, 0, ZONE);
        await routines.resume(PROJECT, 'morning');
        expect(owed().map((entry) => entry.payload.due)).toEqual([zonedTime(2026, 10, 22, 9, 0, ZONE)]);
    });

    test('a restart keeps a time that came due while the machine was off, and runs it once', async () => {
        const first = await build();
        await first.routines.save(PROJECT, 0, morning, false);
        now = zonedTime(2026, 10, 19, 11, 0, ZONE);
        const { routines, runs } = await build();
        await routines.start();
        const pending = owed();
        expect(pending.map((entry) => entry.payload.due)).toEqual([zonedTime(2026, 10, 19, 9, 0, ZONE)]);
        await fire(routines, pending[0]!);
        await fire(routines, { ...pending[0]! });
        expect(started).toHaveLength(1);
        expect(runs.of(PROJECT, 'morning')[0]?.kind).toBe('caught-up');
    });

    test('a restart settles an agent run from its chat, and fails one its chat never began, so the next run is not skipped', async () => {
        const first = await build();
        await first.routines.save(PROJECT, 0, morning, false);
        await first.routines.approve(PROJECT, 'morning', (await first.routines.list(PROJECT)).routines[0]!.digest);
        await first.routines.runNow(PROJECT, 'morning');
        const chatId = started[0]!.chatId;
        chats.set(chatId, { status: 'idle', usage: { turns: 1 } as ChatInfo['usage'] });
        const done = await build();
        await done.routines.start();
        expect(done.runs.ofChat(chatId)?.state).toBe('done');

        await done.routines.runNow(PROJECT, 'morning');
        const second = started[1]!.chatId;
        chats.delete(second);
        const { routines, runs } = await build();
        await routines.start();
        expect(runs.ofChat(second)).toMatchObject({ state: 'failed', error: 'The machine restarted during the run' });
    });

    test('a once runs at its time and owes nothing after', async () => {
        const { routines } = await build();
        const nightly: Routine = { ...morning, id: 'nightly', schedule: { kind: 'once', date: '2026-10-19', time: '22:00' } };
        await routines.save(PROJECT, 0, nightly, false);
        now = zonedTime(2026, 10, 19, 22, 0, ZONE);
        await fire(routines, owed()[0]!);
        expect(started).toHaveLength(1);
        expect(owed()).toEqual([]);
    });

    test('a command delivers its output to Output under the run, and its exit code decides the state', async () => {
        const { routines, runs } = await build();
        await routines.save(
            PROJECT,
            0,
            { id: 'e2e', kind: 'command', title: 'Nightly e2e', command: 'bun run test', schedule: morning.schedule, outputKey: 'e2e' },
            false
        );
        const result = await routines.runNow(PROJECT, 'e2e');
        expect(result.outcome).toBe('started');
        expect(runs.get(result.runId!)?.state).toBe('running');
        commands[0]!.resolve({ exitCode: 1, output: new TextEncoder().encode('1 failed') });
        await routines.settled();
        expect(delivered).toEqual([result.runId!]);
        expect(runs.get(result.runId!)?.state).toBe('failed');
    });
});

describe('approval', () => {
    test('a routine that came in through git waits for a person and is skipped as held when due', async () => {
        const { routines, runs } = await build();
        await mkdir(join(folder, '.ruimte'), { recursive: true });
        await writeFile(join(folder, '.ruimte', 'routines.json'), JSON.stringify({ version: 1, routines: [morning] }));
        const { routines: listed } = await routines.list(PROJECT);
        expect(listed[0]?.approved).toBe(false);
        expect(listed[0]?.held).toBe('outside');
        expect(listed[0]?.shared).toBe(true);
        await routines.schedule(PROJECT);
        expect(owed()).toEqual([]);
        await routines.approve(PROJECT, 'morning', listed[0]!.digest);
        expect(owed()).toHaveLength(1);
        expect(runs.all()).toEqual([]);
    });

    test('what a person picked in the prompt is approved with it, and a routine without picks keeps its digest', () => {
        const picked = { ...morning, picked: { references: ['canvas-1'] } };
        expect(digestOf({ ...morning, picked: undefined })).toBe(digestOf(morning));
        expect(digestOf(picked)).not.toBe(digestOf(morning));
        expect(digestOf({ ...morning, picked: { references: ['canvas-2'] } })).not.toBe(digestOf(picked));
    });

    test('a change from outside asks again, and runs nothing meanwhile', async () => {
        const { routines } = await build();
        await routines.save(PROJECT, 0, morning, true);
        const changed = { ...morning, prompt: 'Push main to production.' };
        await writeFile(join(folder, '.ruimte', 'routines.json'), JSON.stringify({ version: 1, routines: [changed] }));
        await routines.schedule(PROJECT);
        expect(owed()).toEqual([]);
        const { routines: listed } = await routines.list(PROJECT);
        expect(listed[0]?.held).toBe('outside');
        await expect(routines.approve(PROJECT, 'morning', digestOf(morning))).rejects.toMatchObject({ code: 'digest-stale' });
        expect((await routines.runNow(PROJECT, 'morning')).outcome).toBe('held');
    });

    test('an agent never approves, and never sets a mode wider than its own', async () => {
        const { routines } = await build();
        const { routine } = await routines.saveByAgent(PROJECT, { ...morning, mode: 'full-access' }, 'auto-accept-edits', {
            chatId: 'chat-agent',
            title: 'Morning summary',
            at: now
        });
        expect(routine.kind === 'agent' && routine.mode).toBe('auto-accept-edits');
        const { routines: listed } = await routines.list(PROJECT);
        expect(listed[0]?.approved).toBe(false);
        expect(listed[0]?.held).toBe('agent');
        expect(listed[0]?.madeBy?.chatId).toBe('chat-agent');
        expect(owed()).toEqual([]);
        await routines.approve(PROJECT, 'morning', listed[0]!.digest);
        expect(owed()).toHaveLength(1);
    });

    test('a declined routine leaves the approvals until it changes', async () => {
        const { routines } = await build();
        await routines.saveByAgent(PROJECT, morning, 'supervised', { chatId: 'chat-agent', title: 'x', at: now });
        const [entry] = (await routines.list(PROJECT)).routines;
        await routines.decline(PROJECT, 'morning', entry!.digest);
        expect((await routines.list(PROJECT)).routines[0]?.held).toBeUndefined();
        await routines.saveByAgent(PROJECT, { ...morning, prompt: 'Another prompt.' }, 'supervised', { chatId: 'chat-agent', title: 'x', at: now });
        expect((await routines.list(PROJECT)).routines[0]?.held).toBe('agent');
    });
});

describe('what a run says', () => {
    test('the prompt is the message and the brief rides beside it', () => {
        expect(runMessage('Summarize main.', 'Publish it.')).toEqual({ prompt: 'Summarize main.', brief: 'Publish it.' });
    });

    test('a slash command carries the brief as its arguments, since a CLI hears nothing in front of one', () => {
        expect(runMessage('/review', 'Publish it.')).toEqual({ prompt: '/review\n\n---\nPublish it.' });
    });
});
