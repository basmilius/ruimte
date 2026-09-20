import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FLOW_CARDS, type FlowCard, type FlowContent, type FlowRun, type FlowStepEvent, type ProjectContent } from '@ruimte/contracts';
import { needsCeiling, tokenKey } from '@ruimte/flow';
import { FakeWatch } from '../fs/watch-test-helpers.ts';
import { ManualClock } from '../outbox/manual-clock.ts';
import { OutboxStore } from '../outbox/outbox.ts';
import { OutboxWorker, type OutboxHandlers } from '../outbox/outbox-worker.ts';
import { OutboxLink } from '../outbox/wiring.ts';
import { FlowStore } from '../projects/flow-store.ts';
import { ProjectStore } from '../projects/project-store.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { nextMoment } from './runner.ts';
import { wireFlows, type FlowWiring } from './wiring.ts';

let root: string;
let home: string;
let folder: string;
let clock: ManualClock;
let projects: ProjectStore;
let flowFiles: FlowStore;
let flows: FlowWiring;
let worker: OutboxWorker;
let outbox: OutboxStore;
let projectId: string;
let events: SessionEvent[];
let messages: string[];
let minted: number;
let fake: FakeWatch;

const VIEW = 'view-a';

const card = (over: Partial<FlowCard> & Pick<FlowCard, 'kind'>): FlowCard => ({ args: {}, x: 0, y: 0, ...over });

const content = (): ProjectContent => ({
    name: 'repo',
    color: '#123456',
    views: [
        { kind: 'canvas', id: 'main', name: 'Canvas', nodes: [], texts: [], edges: [], layouts: [] },
        { kind: 'flow', id: VIEW, name: 'Watch the readme' }
    ]
});

/* Bas' example: the readme changed, it says Ruimte, so say so. */
const example = (): FlowContent => ({
    cards: {
        trigger: card({ kind: 'trigger', card: 'files.changed', args: { path: 'README.md' } }),
        check: card({ kind: 'condition', card: 'text.contains', args: { text: `@[${tokenKey('trigger', 'content')}]`, value: 'Ruimte', mode: 'contains' } }),
        shout: card({ kind: 'action', card: 'person.notify', args: { text: `@[${tokenKey('trigger', 'path')}] says it` } })
    },
    links: [
        { from: 'trigger', fromPort: 'done', to: 'check' },
        { from: 'check', fromPort: 'true', to: 'shout' }
    ]
});

/* A trigger and one harmless action, for the paths that are about how a run began. */
const byHand = (text = 'it ran'): FlowContent => ({
    cards: {
        trigger: card({ kind: 'trigger', card: 'files.changed', args: { path: 'README.md' } }),
        shout: card({ kind: 'action', card: 'person.notify', args: { text } })
    },
    links: [{ from: 'trigger', fromPort: 'done', to: 'shout' }]
});

/* A trigger and an action nothing in a dry run carries out, which is what makes it worth watching. */
const messaging = (chatId = 'chat-1', text = 'the readme moved'): FlowContent => ({
    cards: {
        trigger: card({ kind: 'trigger', card: 'files.changed', args: { path: 'README.md' } }),
        send: card({ kind: 'action', card: 'chat.message', args: { chat: chatId, text } })
    },
    links: [{ from: 'trigger', fromPort: 'done', to: 'send' }]
});

/* Nothing else runs in these tests, so every other kind of work is a mistake. */
const otherHandlers = (): Omit<OutboxHandlers, 'run-flow' | 'flow-trigger'> => ({
    'start-agent': () => Promise.reject(new Error('no agents here')),
    'resume-run': () => Promise.reject(new Error('no runs here')),
    'wake-parent': () => Promise.reject(new Error('no tasks here')),
    'give-task': () => Promise.reject(new Error('no tasks here')),
    'deliver-message': () => Promise.reject(new Error('no messages here')),
    'end-children': () => Promise.reject(new Error('no children here')),
    'deliver-summary': () => Promise.reject(new Error('no summaries here'))
});

const write = async (recipe: FlowContent, baseRev = 0): Promise<void> => {
    await flowFiles.open(projectId, VIEW);
    await flowFiles.save(projectId, VIEW, baseRev, recipe);
};

const turnOn = (): Promise<unknown> => flows.enable({ projectId, viewId: VIEW, enabled: true }, 'bas');

const fire = async (tokens: Record<string, string> = {}, depth = 1): Promise<void> => {
    await flows.runner.fire(projectId, VIEW, { cardId: 'trigger', tokens }, depth);
    await worker.settled();
};

const runs = (): Promise<FlowRun[]> => flows.timeline.runs(projectId, VIEW);

const notices = (): string[] => events.filter((event) => event.event === 'flow.notice').map((event) => (event.payload as { text: string }).text);

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-flow-runner-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder);
    clock = new ManualClock();
    minted = 0;
    events = [];
    messages = [];
    fake = new FakeWatch();
    projects = new ProjectStore(home, fake);
    flowFiles = new FlowStore(projects, fake);
    projects.attachFlows(flowFiles);
    outbox = new OutboxStore(home);
    await outbox.load();
    const link = new OutboxLink({ outbox, projectOf: () => null });
    flows = wireFlows({
        home,
        projects,
        flows: flowFiles,
        outbox,
        link,
        message: async (chatId, text) => {
            messages.push(`${chatId}: ${text}`);
            return chatId !== 'gone';
        },
        now: () => clock.now(),
        mintId: () => `${(minted += 1)}`,
        seams: fake
    });
    worker = new OutboxWorker({ store: outbox, clock, handlers: { ...otherHandlers(), ...flows.handlers } });
    link.bind(worker);
    worker.start();
    flows.subscribe('c1', (event) => events.push(event));
    const opened = await projects.openProject({ folder });
    projectId = opened.summary.projectId;
    await projects.save(projectId, 0, content());
    await flows.start();
});

afterEach(async () => {
    worker.stop();
    flows.stop();
    flowFiles.closeAll();
    projects.closeAll();
    await rm(root, { recursive: true, force: true });
});

describe('a flow that is turned on', () => {
    test("runs Bas' example end to end and writes down every card it passed", async () => {
        await write(example());
        await turnOn();
        await fire({ [tokenKey('trigger', 'path')]: 'README.md', [tokenKey('trigger', 'content')]: 'This is Ruimte' });

        expect(notices()).toEqual(['README.md says it']);
        const [run] = await runs();
        expect(run?.outcome).toBe('done');
        expect(run?.steps.map((step) => [step.cardId, step.port])).toEqual([
            ['trigger', 'done'],
            ['check', 'true'],
            ['shout', 'done']
        ]);
    });

    test('a condition that is false stops the branch, and nothing after it runs', async () => {
        await write(example());
        await turnOn();
        await fire({ [tokenKey('trigger', 'content')]: 'nothing to see' });

        expect(notices()).toEqual([]);
        const [run] = await runs();
        expect(run?.outcome).toBe('done');
        expect(run?.steps.map((step) => step.cardId)).toEqual(['trigger', 'check']);
    });

    test('inverted reads a condition the other way round', async () => {
        const recipe = example();
        await write({ ...recipe, cards: { ...recipe.cards, check: { ...(recipe.cards.check as FlowCard), inverted: true } } });
        await turnOn();
        await fire({ [tokenKey('trigger', 'content')]: 'nothing to see' });

        expect(notices()).toEqual([' says it']);
    });

    test('a flow that is off does nothing at all', async () => {
        await write(example());
        await fire({ [tokenKey('trigger', 'content')]: 'This is Ruimte' });

        expect(notices()).toEqual([]);
        expect(await runs()).toEqual([]);
    });
});

describe('a wait card', () => {
    const waiting = (): FlowContent => ({
        cards: {
            trigger: card({ kind: 'trigger', card: 'files.changed', args: { path: 'README.md' } }),
            hold: card({ kind: 'delay', args: { amount: 30, unit: 'seconds' } }),
            shout: card({ kind: 'action', card: 'person.notify', args: { text: 'later' } })
        },
        links: [
            { from: 'trigger', fromPort: 'done', to: 'hold' },
            { from: 'hold', fromPort: 'done', to: 'shout' }
        ]
    });

    test('parks the run until its moment, without a timer in anyone memory', async () => {
        await write(waiting());
        await turnOn();
        await fire();

        expect(notices()).toEqual([]);
        expect((await runs())[0]?.outcome).toBe('running');
        // The entry that wakes it is on disk with a time on it, which is what a restart would read.
        expect((await runs())[0]?.waiting).toEqual(['hold']);

        clock.advance(30_000);
        await worker.settled();
        expect(notices()).toEqual(['later']);
        expect((await runs())[0]?.outcome).toBe('done');
    });

    test('a second trigger while the run is parked is skipped, with the reason', async () => {
        await write(waiting());
        await turnOn();
        await fire();
        await fire();

        const skipped = (await runs()).find((run) => run.outcome === 'skipped');
        expect(skipped?.note).toContain('still going');
    });
});

describe('what stops a run', () => {
    test('a chain of flows stops at three deep', async () => {
        await write(example());
        await turnOn();
        await fire({}, 4);

        const [run] = await runs();
        expect(run?.outcome).toBe('refused');
        expect(run?.note).toContain('3 deep');
    });

    test('more than ten runs in a minute puts the flow to sleep and says so', async () => {
        await write(example());
        await turnOn();
        for (let attempt = 0; attempt < 11; attempt += 1) {
            await fire({ [tokenKey('trigger', 'content')]: 'quiet' });
        }

        const asleep = (await runs()).filter((run) => run.outcome === 'skipped');
        expect(asleep).toHaveLength(1);
        expect(notices()[0]).toContain('sleeping it off');
    });

    test('a recipe that changed after it was turned on puts the flow back on off', async () => {
        await write(example());
        await turnOn();
        const changed = example();
        await write({ ...changed, cards: { ...changed.cards, shout: card({ kind: 'action', card: 'person.notify', args: { text: 'something else' } }) } }, 1);
        await fire({ [tokenKey('trigger', 'content')]: 'This is Ruimte' });

        expect(flows.switches.of(projectId, VIEW).enabled).toBe(false);
        expect(notices()[0]).toContain('says yes again');
        expect((await runs())[0]?.outcome).toBe('refused');
    });

    test('moving a card is not a change, so the flow keeps running', async () => {
        await write(example());
        await turnOn();
        const moved = example();
        await write({ ...moved, cards: { ...moved.cards, shout: { ...(moved.cards.shout as FlowCard), x: 900, y: 400 } } }, 1);
        await fire({ [tokenKey('trigger', 'path')]: 'README.md', [tokenKey('trigger', 'content')]: 'This is Ruimte' });

        expect(flows.switches.of(projectId, VIEW).enabled).toBe(true);
        expect(notices()).toEqual(['README.md says it']);
    });
});

describe('an action that can fail', () => {
    const messaging = (chatId: string): FlowContent => ({
        cards: {
            trigger: card({ kind: 'trigger', card: 'files.changed', args: { path: 'README.md' } }),
            send: card({ kind: 'action', card: 'chat.message', args: { chat: chatId, text: 'the readme moved' } }),
            shout: card({ kind: 'action', card: 'person.notify', args: { text: 'could not reach the chat' } })
        },
        links: [
            { from: 'trigger', fromPort: 'done', to: 'send' },
            { from: 'send', fromPort: 'error', to: 'shout' }
        ]
    });

    test('takes its error port when it fails, and only then', async () => {
        await write(messaging('gone'));
        await turnOn();
        await fire();

        expect(notices()).toEqual(['could not reach the chat']);
        expect((await runs())[0]?.steps.find((step) => step.cardId === 'send')?.port).toBe('error');
    });

    test('leaves the error branch alone when it went well', async () => {
        await write(messaging('chat-1'));
        await turnOn();
        await fire();

        expect(messages).toEqual(['chat-1: the readme moved']);
        expect(notices()).toEqual([]);
    });
});

describe('a card this build does not know', () => {
    test('stops its branch and says so, rather than taking the flow down', async () => {
        await write({
            cards: {
                trigger: card({ kind: 'trigger', card: 'files.changed', args: { path: 'README.md' } }),
                odd: card({ kind: 'action', card: 'mail.send', args: { to: 'someone' } })
            },
            links: [{ from: 'trigger', fromPort: 'done', to: 'odd' }]
        });
        await turnOn();
        await fire();

        const [run] = await runs();
        expect(run?.outcome).toBe('done');
        expect(run?.steps.find((step) => step.cardId === 'odd')?.note).toContain('mail.send');
    });
});

describe('when a time trigger comes round', () => {
    const at = (time: string, every = 'day'): FlowCard => card({ kind: 'trigger', card: 'time.at', args: { every, at: time } });

    /* A Wednesday at noon, in the time zone of whoever runs the test. */
    const noon = new Date(2026, 8, 16, 12, 0, 0, 0).getTime();

    test('every day means the next time that clock reads it', () => {
        expect(nextMoment(at('14:30'), noon)).toBe(new Date(2026, 8, 16, 14, 30, 0, 0).getTime());
        expect(nextMoment(at('09:00'), noon)).toBe(new Date(2026, 8, 17, 9, 0, 0, 0).getTime());
    });

    test('a weekday skips the weekend', () => {
        const friday = new Date(2026, 8, 18, 18, 0, 0, 0).getTime();
        expect(nextMoment(at('09:00', 'weekday'), friday)).toBe(new Date(2026, 8, 21, 9, 0, 0, 0).getTime());
    });

    test('every so many minutes counts from now, and a time nobody can read is no moment at all', () => {
        expect(nextMoment(card({ kind: 'trigger', card: 'time.at', args: { every: 'minutes', minutes: 15 } }), noon)).toBe(noon + 15 * 60_000);
        expect(nextMoment(at('nonsense'), noon)).toBeNull();
        expect(nextMoment(at('25:00'), noon)).toBeNull();
    });

    test('turning a flow on owes its moment on the outbox, and turning it off takes it back', async () => {
        await write({ cards: { trigger: at('14:30') }, links: [] });
        await turnOn();
        const owed = outbox.list().filter((entry) => entry.kind === 'flow-trigger');
        expect(owed).toHaveLength(1);
        // On disk with a time on it, which is what a machine that slept through it reads back.
        expect(owed[0]?.notBefore).toBeGreaterThan(clock.now());

        await flows.enable({ projectId, viewId: VIEW, enabled: false }, 'bas');
        expect(outbox.list().filter((entry) => entry.kind === 'flow-trigger')).toHaveLength(0);
    });
});

describe('when a file changes', () => {
    const watching = (path: string): FlowContent => ({
        cards: {
            trigger: card({ kind: 'trigger', card: 'files.changed', args: { path } }),
            shout: card({
                kind: 'action',
                card: 'person.notify',
                args: { text: `@[${tokenKey('trigger', 'path')}] moved: @[${tokenKey('trigger', 'content')}]` }
            })
        },
        links: [{ from: 'trigger', fromPort: 'done', to: 'shout' }]
    });

    test('the flow runs with the path and the text of the file as tokens', async () => {
        await writeFile(join(folder, 'README.md'), 'This is Ruimte');
        await write(watching('README.md'));
        await turnOn();

        await flows.watcher.touched(folder, ['README.md']);
        await worker.settled();
        expect(notices()).toEqual(['README.md moved: This is Ruimte']);
    });

    test('a folder on the card catches everything under it, and nothing beside it', async () => {
        await mkdir(join(folder, 'docs'));
        await writeFile(join(folder, 'docs', 'plan.md'), 'a plan');
        await write(watching('docs'));
        await turnOn();

        await flows.watcher.touched(folder, ['README.md']);
        await worker.settled();
        expect(notices()).toEqual([]);

        await flows.watcher.touched(folder, ['docs/plan.md']);
        await worker.settled();
        expect(notices()).toEqual(['docs/plan.md moved: a plan']);
    });

    test('nothing a flow writes itself sets one off, so the folders of git and Ruimte are left out', async () => {
        await write(watching('.ruimte'));
        await turnOn();

        await flows.watcher.touched(folder, ['.ruimte/project.json', '.git/index']);
        await worker.settled();
        expect(notices()).toEqual([]);
    });

    test('a flow that is on is watched, and turning it off closes the watch', async () => {
        await write(watching('README.md'));
        await turnOn();
        expect(fake.openOn(folder)).toHaveLength(1);

        await flows.enable({ projectId, viewId: VIEW, enabled: false }, 'bas');
        expect(fake.openOn(folder)).toHaveLength(0);
    });
});

describe('running a flow by hand', () => {
    test('runs it now, for real, without waiting for the trigger to come round', async () => {
        await write(byHand());
        await turnOn();
        await flows.runner.start({ projectId, viewId: VIEW, cardId: 'trigger' }, 'bas');
        await worker.settled();

        expect(notices()).toEqual(['it ran']);
        const [run] = await runs();
        expect(run?.outcome).toBe('done');
        expect(run?.dry).toBeUndefined();
        expect(run?.test).toBeUndefined();
    });

    test('a flow that is off is not started by hand, since that is what a test is for', async () => {
        await write(byHand());
        const run = await flows.runner.start({ projectId, viewId: VIEW, cardId: 'trigger' }, 'bas');
        await worker.settled();

        expect(run).toBeNull();
        expect(await runs()).toEqual([]);
        expect(notices()).toEqual([]);
    });

    test('fills in what the trigger would have published, so a moment card has its time', async () => {
        await write({
            cards: {
                trigger: card({ kind: 'trigger', card: 'time.at', args: { every: 'day', at: '08:00' } }),
                shout: card({ kind: 'action', card: 'person.notify', args: { text: `@[${tokenKey('trigger', 'time')}]` } })
            },
            links: [{ from: 'trigger', fromPort: 'done', to: 'shout' }]
        });
        await turnOn();
        await flows.runner.start({ projectId, viewId: VIEW, cardId: 'trigger' }, 'bas');
        await worker.settled();

        // The clock of this test, not the card: by hand is now, and 08:00 is when it would have fired.
        expect(notices()[0]).toMatch(/^\d{2}:\d{2}$/);
    });

    test('refuses a card no run can begin at', async () => {
        await write(byHand());
        await turnOn();

        await expect(flows.runner.start({ projectId, viewId: VIEW, cardId: 'shout' }, 'bas')).rejects.toThrow('begin at');
    });
});

describe('a test run', () => {
    const tryOut = (over: Partial<Parameters<typeof flows.runner.test>[0]> = {}): Promise<FlowRun | null> =>
        flows.runner.test({ projectId, viewId: VIEW, from: 'trigger', scope: 'graph', dry: true, ...over }, 'bas');

    test('a flow that is off can be tested, which is the whole point', async () => {
        await write(byHand());
        await tryOut();
        await worker.settled();

        expect(flows.switches.of(projectId, VIEW).enabled).toBe(false);
        expect((await runs())[0]?.outcome).toBe('done');
    });

    test('stands apart in the timeline, with who started it and the card it began at', async () => {
        await write(byHand());
        await tryOut({ from: 'shout', scope: 'card' });
        await worker.settled();

        const [run] = await runs();
        expect(run?.test).toEqual({ from: 'shout', scope: 'card', by: 'bas' });
        expect(run?.dry).toBe(true);
    });

    test('dry writes down what a card would have done, with the tokens filled in', async () => {
        await write(messaging('chat-1', `@[${tokenKey('trigger', 'path')}] moved`));
        await tryOut({ tokens: { [tokenKey('trigger', 'path')]: 'README.md' } });
        await worker.settled();

        expect(messages).toEqual([]);
        const step = (await runs())[0]?.steps.find((entry) => entry.cardId === 'send');
        expect(step?.dry).toBe(true);
        expect(step?.port).toBe('done');
        expect(step?.note).toContain('README.md moved');
    });

    test('a card the catalog calls harmless is carried out even in a dry run', async () => {
        await write(byHand());
        await tryOut();
        await worker.settled();

        expect(notices()).toEqual(['it ran']);
        expect((await runs())[0]?.steps.find((step) => step.cardId === 'shout')?.dry).toBeUndefined();
    });

    test('every condition runs for real, so a dry test takes the path the real run would take', async () => {
        await write(example());
        await tryOut({ tokens: { [tokenKey('trigger', 'content')]: 'nothing to see' } });
        await worker.settled();

        const [run] = await runs();
        expect(run?.steps.find((step) => step.cardId === 'check')?.port).toBe('false');
        expect(run?.steps.map((step) => step.cardId)).toEqual(['trigger', 'check']);
    });

    test('from halfway down runs on the tokens it was handed', async () => {
        await write(example());
        await tryOut({
            from: 'check',
            tokens: { [tokenKey('trigger', 'path')]: 'README.md', [tokenKey('trigger', 'content')]: 'This is Ruimte' }
        });
        await worker.settled();

        expect(notices()).toEqual(['README.md says it']);
        expect((await runs())[0]?.steps.map((step) => step.cardId)).toEqual(['check', 'shout']);
    });

    test('only this card runs one card and closes the run, without following a line', async () => {
        await write(example());
        await tryOut({ from: 'check', scope: 'card', tokens: { [tokenKey('trigger', 'content')]: 'This is Ruimte' } });
        await worker.settled();

        expect(notices()).toEqual([]);
        const [run] = await runs();
        expect(run?.outcome).toBe('done');
        expect(run?.steps.map((step) => step.cardId)).toEqual(['check']);
    });

    test('walks straight past a wait card, with how long it would really have waited', async () => {
        await write({
            cards: {
                trigger: card({ kind: 'trigger', card: 'files.changed', args: { path: 'README.md' } }),
                hold: card({ kind: 'delay', args: { amount: 30, unit: 'minutes' } }),
                shout: card({ kind: 'action', card: 'person.notify', args: { text: 'later' } })
            },
            links: [
                { from: 'trigger', fromPort: 'done', to: 'hold' },
                { from: 'hold', fromPort: 'done', to: 'shout' }
            ]
        });
        await tryOut();
        await worker.settled();

        const [run] = await runs();
        expect(run?.outcome).toBe('done');
        expect(run?.steps.find((step) => step.cardId === 'hold')?.note).toContain('1800 s');
        expect(notices()).toEqual(['later']);
    });

    test('counts toward the speed brake like any other run', async () => {
        await write(byHand());
        for (let attempt = 0; attempt < 11; attempt += 1) {
            await tryOut();
            await worker.settled();
        }

        const asleep = (await runs()).filter((run) => run.outcome === 'skipped');
        expect(asleep).toHaveLength(1);
        // Even the line that says no stands apart, or a test would pollute the history it looks at.
        expect(asleep[0]?.test?.from).toBe('trigger');
    });

    test('no card in the catalog asks for the mode ceiling yet, so nothing refuses on it', () => {
        expect(FLOW_CARDS.filter((definition) => definition.needsCeiling === true)).toEqual([]);
        expect(FLOW_CARDS.map((definition) => needsCeiling(card({ kind: definition.kind, card: definition.id })))).not.toContain(true);
    });
});

describe('a flow that is watching', () => {
    test('fires on its trigger and carries nothing out', async () => {
        await write(messaging());
        await flows.enable({ projectId, viewId: VIEW, enabled: true, watching: true }, 'bas');
        await fire();

        expect(messages).toEqual([]);
        const [run] = await runs();
        expect(run?.dry).toBe(true);
        // A run of the flow itself, not something a person started: the timeline keeps those apart.
        expect(run?.test).toBeUndefined();
        expect(run?.steps.find((step) => step.cardId === 'send')?.note).toContain('the readme moved');
    });
});

describe('a test waiting for the next real firing', () => {
    const arm = (from: string, over: { dry?: boolean } = {}): Promise<unknown> =>
        flows.runner.armTest({ projectId, viewId: VIEW, test: { from, scope: 'graph', dry: true, ...over } }, 'bas');

    test('makes a flow that is off listen, and is spent on the first firing with its real tokens', async () => {
        await writeFile(join(folder, 'README.md'), 'This is Ruimte');
        await write(byHand(`@[${tokenKey('trigger', 'path')}] says it`));
        await arm('shout');
        expect(fake.openOn(folder)).toHaveLength(1);

        await flows.watcher.touched(folder, ['README.md']);
        await worker.settled();

        expect(notices()).toEqual(['README.md says it']);
        const [run] = await runs();
        expect(run?.test).toEqual({ from: 'shout', scope: 'graph', by: 'bas' });
        expect(run?.tokens[tokenKey('trigger', 'path')]).toBe('README.md');
        // One shot: the flow is off again with nothing waiting on it, so nothing is watched either.
        expect((await flows.runner.state(projectId, VIEW)).armed).toBeUndefined();
        expect(fake.openOn(folder)).toHaveLength(0);
    });

    test('is taken back with null', async () => {
        await write(byHand());
        await arm('shout');
        await flows.runner.armTest({ projectId, viewId: VIEW, test: null }, 'bas');

        expect((await flows.runner.state(projectId, VIEW)).armed).toBeUndefined();
        expect(fake.openOn(folder)).toHaveLength(0);
    });

    test('listens for nothing once the recipe loses the card it starts from', async () => {
        await write(byHand());
        await arm('shout');
        expect(fake.openOn(folder)).toHaveLength(1);

        await write({ cards: { trigger: card({ kind: 'trigger', card: 'files.changed', args: { path: 'README.md' } }) }, links: [] }, 1);
        await flows.rearm(projectId, VIEW);

        expect(fake.openOn(folder)).toHaveLength(0);
        await flows.watcher.touched(folder, ['README.md']);
        await worker.settled();
        expect(await runs()).toEqual([]);
    });
});

describe('while a run goes', () => {
    const lit = (): FlowStepEvent[] => events.filter((event) => event.event === 'flow.step').map((event) => event.payload as FlowStepEvent);

    test('every card that settles goes out with the whole state of the run', async () => {
        await write(example());
        await turnOn();
        await fire({ [tokenKey('trigger', 'path')]: 'README.md', [tokenKey('trigger', 'content')]: 'This is Ruimte' });

        expect(lit().map((event) => event.step.cardId)).toEqual(['trigger', 'check', 'shout']);
        const last = lit()[2];
        expect(last?.settled).toEqual({ trigger: 'done', check: 'true', shout: 'done' });
        expect(last?.waiting).toEqual([]);
    });

    test('a test lights the worksheet up the same way', async () => {
        await write(byHand());
        await flows.runner.test({ projectId, viewId: VIEW, from: 'trigger', scope: 'graph', dry: true }, 'bas');
        await worker.settled();

        expect(lit().map((event) => event.step.cardId)).toEqual(['trigger', 'shout']);
    });

    test('a run parked on a wait card says which card it waits on', async () => {
        await write({
            cards: {
                trigger: card({ kind: 'trigger', card: 'files.changed', args: { path: 'README.md' } }),
                hold: card({ kind: 'delay', args: { amount: 30, unit: 'seconds' } })
            },
            links: [{ from: 'trigger', fromPort: 'done', to: 'hold' }]
        });
        await turnOn();
        await fire();

        expect(lit()[1]?.waiting).toEqual(['hold']);
    });
});
