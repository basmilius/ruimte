import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatItem, Plan, ProjectContent } from '@ruimte/contracts';
import { PLAN_RESUME_PREAMBLE, RESUME_PROMPT } from '../chat/chat-session.ts';
import { ManualClock } from '../outbox/manual-clock.ts';
import { ProjectStore } from '../projects/project-store.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { bootTestDaemon, runVerb, type TestDaemon } from '../tasks/test-daemon.ts';
import { planFileName } from './plan-store.ts';

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

const DOCUMENT = JSON.stringify({
    meta: { title: 'Ship the feature' },
    items: [
        { type: 'step', id: 'build', title: 'Build it' },
        { type: 'step', id: 'tests', title: 'Write the tests' },
        { type: 'step', id: 'check', title: 'A person checks it', checks: 'person' },
        { type: 'step', id: 'mine', title: 'Only the agent', checks: 'agent' }
    ]
});

let root: string;
let home: string;
let folder: string;
let store: ProjectStore;
let clock: ManualClock;
let running: TestDaemon[];

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-plans-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    store = new ProjectStore(home);
    const opened = await store.openProject({ folder });
    await store.save(opened.summary.projectId, opened.document.rev, content());
    store.release(opened.summary.projectId);
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

const boot = async (installed: ('claude' | 'codex')[] = ['claude']): Promise<TestDaemon> => {
    const daemon = await bootTestDaemon({ home, store, clock, installed });
    running.push(daemon);
    return daemon;
};

const listen = (daemon: TestDaemon): SessionEvent[] => {
    const events: SessionEvent[] = [];
    daemon.plans.subscribe('test', (event) => events.push(event));
    return events;
};

const newPlan = async (daemon: TestDaemon, document = DOCUMENT): Promise<string> => {
    const lines = await runVerb(daemon, 'chat-lead', 'plan', ['new', `--document=${document}`]);
    const [kind, planId] = lines[0]!.split('\t');
    expect(kind).toBe('plan');
    return planId!;
};

const refusalCode = (lines: string[]): string | undefined => (lines[0]!.startsWith('refused\t') ? lines[0]!.split('\t')[1] : undefined);

const planOf = async (daemon: TestDaemon, planId: string): Promise<Plan> => (await daemon.plans.read('chat-lead')).find((plan) => plan.id === planId)!;

const stepOf = (plan: Plan, id: string) => plan.items.find((item) => item.id === id) as Extract<Plan['items'][number], { type: 'step' }>;

const exists = (path: string): Promise<boolean> =>
    stat(path).then(
        () => true,
        () => false
    );

describe('plan verbs', () => {
    test('plan new from a chat writes the plan and sends plan.changed and plan.created; a terminal is refused', async () => {
        const daemon = await boot();
        const events = listen(daemon);

        const lines = await runVerb(daemon, 'chat-lead', 'plan', ['new', '--kind', 'test', `--document=${DOCUMENT}`]);
        const [first, ...rest] = lines;
        const [, planId, rev, kind, title] = first!.split('\t');
        expect([rev, kind, title]).toEqual(['rev 0', 'test', 'Ship the feature']);
        expect(rest).toEqual([
            'item\tbuild\tstep\t-\tBuild it',
            'item\ttests\tstep\t-\tWrite the tests',
            'item\tcheck\tstep\t-\tA person checks it',
            'item\tmine\tstep\t-\tOnly the agent',
            'example\truimte-context plan set build --state done'
        ]);
        expect(events.map((event) => event.event)).toEqual(['plan.changed', 'plan.created']);
        expect(events[0]!.payload).toMatchObject({ chatId: 'chat-lead', plan: { id: planId, rev: 0, createdAt: new Date(clock.now()).toISOString() } });
        expect(events[1]!.payload).toEqual({ chatId: 'chat-lead', planId: planId! });
        const file = JSON.parse(await readFile(join(home, 'chats', planFileName('chat-lead')), 'utf8')) as { version: number; plans: Plan[] };
        expect(file.version).toBe(1);
        expect(file.plans.map((plan) => plan.id)).toEqual([planId!]);

        const refused = await runVerb(daemon, 'term-lead', 'plan', ['new', `--document=${DOCUMENT}`]);
        expect(refusalCode(refused)).toBe('plan-needs-chat');
        expect(events).toHaveLength(2);
    });

    test('a dry run writes nothing, a misspelled field is refused by its path, and Markdown makes a plan too', async () => {
        const daemon = await boot();
        const events = listen(daemon);
        const dry = await runVerb(daemon, 'chat-lead', 'plan', ['new', '--dry-run', `--document=${DOCUMENT}`]);
        expect(dry[0]).toStartWith('dry run\tplan-');
        expect(await daemon.plans.read('chat-lead')).toEqual([]);
        expect(events).toEqual([]);

        const misspelled = await runVerb(daemon, 'chat-lead', 'plan', ['new', '--document={"meta":{"title":"T"},"items":[{"type":"step","titel":"x"}]}']);
        expect(refusalCode(misspelled)).toBe('plan-invalid');

        const markdown = await runVerb(daemon, 'chat-lead', 'plan', ['new', '--markdown=# From a list\n\n## Build\n- [x] Compile\n- [ ] Run']);
        expect(markdown[0]).toMatch(/^plan\tplan-[a-z0-9]+\trev 0\tsteps\tFrom a list$/);
        const read = await runVerb(daemon, 'chat-lead', 'plan', ['read']);
        expect(read[0]).toMatch(/^Plan "From a list" \(plan-[a-z0-9]+, steps, rev 0\): 1 of 2 done$/);
    });

    test('the agent is refused person-only, set-by-person and unlocked-by-person where due', async () => {
        const daemon = await boot();
        const planId = await newPlan(daemon);

        expect(refusalCode(await runVerb(daemon, 'chat-lead', 'plan', ['set', 'check', '--state', 'done']))).toBe('person-only');

        expect(await daemon.request('plan.apply', { chatId: 'chat-lead', planId, ops: [{ op: 'set', ids: ['build'], state: 'failed' }] })).toMatchObject({
            ok: true,
            result: { plan: { rev: 1 } }
        });
        const bySomeone = await runVerb(daemon, 'chat-lead', 'plan', ['set', 'build', '--state', 'done']);
        expect(refusalCode(bySomeone)).toBe('set-by-person');
        expect(bySomeone.at(-1)).toStartWith('see\truimte-context plan note');
        expect(refusalCode(await runVerb(daemon, 'chat-lead', 'plan', ['remove', 'build']))).toBe('set-by-person');
        expect((await runVerb(daemon, 'chat-lead', 'plan', ['note', 'build', '--text', 'Fixed in abc123']))[0]).toStartWith(`plan\t${planId}\trev 2`);

        // A person taking the mark away frees the step again.
        await daemon.request('plan.apply', { chatId: 'chat-lead', planId, ops: [{ op: 'set', ids: ['build'], state: 'open' }] });
        expect(refusalCode(await runVerb(daemon, 'chat-lead', 'plan', ['set', 'build', '--state', 'done']))).toBeUndefined();

        expect(await daemon.request('plan.apply', { chatId: 'chat-lead', planId, ops: [{ op: 'set', ids: ['mine'], state: 'done' }] })).toMatchObject({
            ok: false,
            error: { code: 'step-locked' }
        });
        expect(await daemon.request('plan.apply', { chatId: 'chat-lead', planId, ops: [{ op: 'unlock', ids: ['mine'] }] })).toMatchObject({ ok: true });
        expect(refusalCode(await runVerb(daemon, 'chat-lead', 'plan', ['edit', 'mine', '--checks', 'agent']))).toBe('unlocked-by-person');

        // The structure is the agent's alone.
        expect(await daemon.request('plan.apply', { chatId: 'chat-lead', planId, ops: [{ op: 'remove', id: 'mine' } as never] })).toMatchObject({
            ok: false,
            error: { code: 'bad-request' }
        });
    });

    test('a click through plan.apply and a verb at the same moment both land, one rev each', async () => {
        const daemon = await boot();
        const planId = await newPlan(daemon);
        const [clicked, verbed] = await Promise.all([
            daemon.request('plan.apply', { chatId: 'chat-lead', planId, ops: [{ op: 'set', ids: ['check'], state: 'done' }] }),
            runVerb(daemon, 'chat-lead', 'plan', ['set', 'build', '--state', 'active'])
        ]);
        expect(clicked).toMatchObject({ ok: true });
        expect(refusalCode(verbed)).toBeUndefined();
        const plan = await planOf(daemon, planId);
        expect(plan.rev).toBe(2);
        expect(stepOf(plan, 'check')).toMatchObject({ state: 'done', by: 'person' });
        expect(stepOf(plan, 'build')).toMatchObject({ state: 'active', by: 'agent' });
    });

    test('--next finishes one step and makes the next active in the same rev', async () => {
        const daemon = await boot();
        const planId = await newPlan(daemon);
        const events = listen(daemon);
        await runVerb(daemon, 'chat-lead', 'plan', ['set', 'build', '--state', 'active']);
        const lines = await runVerb(daemon, 'chat-lead', 'plan', ['set', 'build', '--state', 'done', '--next', 'tests']);
        expect(lines).toEqual([`plan\t${planId}\trev 2\tsteps\tShip the feature\t1 of 4 done`, 'now\ttests']);
        const plan = await planOf(daemon, planId);
        expect(stepOf(plan, 'build').state).toBe('done');
        expect(stepOf(plan, 'tests').state).toBe('active');
        expect(events.map((event) => event.event)).toEqual(['plan.changed', 'plan.changed']);
    });

    test('a chat keeps at most twenty plans, and the refusal points at plan delete', async () => {
        const daemon = await boot();
        for (let i = 0; i < 20; i++) {
            await newPlan(daemon);
        }
        const refused = await runVerb(daemon, 'chat-lead', 'plan', ['new', `--document=${DOCUMENT}`]);
        expect(refusalCode(refused)).toBe('too-many-plans');
        expect(refused.at(-1)).toStartWith('see\truimte-context plan delete --plan P');
        const oldest = (await daemon.plans.read('chat-lead'))[0]!.id;
        expect(await runVerb(daemon, 'chat-lead', 'plan', ['delete', '--plan', oldest])).toEqual([`deleted\t${oldest}\tShip the feature`]);
        expect(refusalCode(await runVerb(daemon, 'chat-lead', 'plan', ['new', `--document=${DOCUMENT}`]))).toBeUndefined();
    });
});

describe('plans and the chat they belong to', () => {
    const turnsOf = (items: readonly ChatItem[]) => items.filter((item) => item.kind === 'turn');

    const say = async (daemon: TestDaemon, chatId: string, text: string): Promise<void> => {
        const before = turnsOf(daemon.chats.get(chatId)?.thread.list() ?? []).length;
        await daemon.chats.send(chatId, text);
        await daemon.until(() => {
            const chat = daemon.chats.get(chatId);
            return chat !== undefined && chat.info.activeTurnId === null && turnsOf(chat.thread.list()).length === before + 1;
        });
    };

    test('a restarted daemon reads the plan, and a resumed turn is told about it', async () => {
        const first = await boot();
        first.worker.start();
        const planId = await newPlan(first);
        await first.chats.create({ chatId: 'chat-lead', cwd: folder, provider: 'claude' });
        await first.chats.send('chat-lead', 'slow');
        const lead = first.chats.get('chat-lead')!;
        await first.until(() => lead.info.agentSessionId !== null);
        const turnId = lead.info.activeTurnId!;
        running.splice(running.indexOf(first), 1);
        await first.stop();

        const second = await boot();
        expect(await second.request('plan.list', {})).toMatchObject({ ok: true, result: { plans: [{ chatId: 'chat-lead', plan: { id: planId } }] } });
        expect((await runVerb(second, 'chat-lead', 'plan', ['read']))[0]).toStartWith(`Plan "Ship the feature" (${planId}, steps, rev 0)`);

        second.worker.start();
        await second.chats.recoverInterrupted();
        const turnDone = (): boolean => {
            const turn = second.chats.get('chat-lead')?.thread.get(turnId);
            return turn?.kind === 'turn' && turn.state === 'done';
        };
        await second.until(turnDone);
        const replies = second.chats
            .get('chat-lead')!
            .thread.list()
            .flatMap((item) => (item.kind === 'assistant' && item.turnId === turnId ? [item.text] : []));
        expect(replies.some((text) => text.includes(`${PLAN_RESUME_PREAMBLE}\n\n`) && text.endsWith(RESUME_PROMPT))).toBe(true);
    });

    test('a fork gets a copy of the plans, and a change in the fork leaves the original alone', async () => {
        const daemon = await boot(['claude', 'codex']);
        daemon.worker.start();
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        await say(daemon, 'chat-lead', 'one');
        const planId = await newPlan(daemon);
        await runVerb(daemon, 'chat-lead', 'plan', ['set', 'build', '--state', 'done']);
        const events = listen(daemon);

        const turn = turnsOf(daemon.chats.get('chat-lead')!.thread.list())[0]!;
        const answer = await daemon.request('chat.fork', { chatId: 'chat-lead', turnId: turn.id, provider: 'codex' });
        expect(answer).toMatchObject({ ok: true });
        const { nodeId } = (answer as { result: { nodeId: string } }).result;

        const copied = await daemon.plans.read(nodeId);
        expect(copied).toEqual(await daemon.plans.read('chat-lead'));
        expect(events).toEqual([{ event: 'plan.changed', payload: { chatId: nodeId, plan: copied[0]! } }]);

        await runVerb(daemon, nodeId, 'plan', ['set', 'tests', '--state', 'done']);
        expect(stepOf((await daemon.plans.read(nodeId))[0]!, 'tests').state).toBe('done');
        const original = await planOf(daemon, planId);
        expect(original.rev).toBe(1);
        expect(stepOf(original, 'tests').state).toBeUndefined();
    });

    test('clearing a chat removes its plans file and says so for each plan', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        const planId = await newPlan(daemon);
        const path = join(home, 'chats', planFileName('chat-lead'));

        const events = listen(daemon);
        expect(await daemon.request('chat.clear', { chatId: 'chat-lead' })).toMatchObject({ ok: true });
        expect(await exists(path)).toBe(false);
        expect(events).toEqual([{ event: 'plan.removed', payload: { chatId: 'chat-lead', planId } }]);
        expect(await daemon.request('plan.list', {})).toMatchObject({ ok: true, result: { plans: [] } });
    });

    test('killing a chat removes its plans file and says so for each plan', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        const planId = await newPlan(daemon);
        const path = join(home, 'chats', planFileName('chat-lead'));

        const events = listen(daemon);
        expect(await daemon.request('chat.kill', { chatId: 'chat-lead' })).toMatchObject({ ok: true });
        expect(await exists(path)).toBe(false);
        expect(events).toEqual([{ event: 'plan.removed', payload: { chatId: 'chat-lead', planId } }]);
        expect(await daemon.request('plan.list', {})).toMatchObject({ ok: true, result: { plans: [] } });
    });
});
