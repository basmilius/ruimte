import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FlowCard, FlowContent, FlowRun, ProjectContent } from '@ruimte/contracts';
import { tokenKey } from '@ruimte/flow';
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
