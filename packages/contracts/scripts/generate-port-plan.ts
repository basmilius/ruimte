import { resolve } from 'node:path';
import {
    PLAN_PERSON_STATES,
    PLAN_STATE_MARKERS,
    PLAN_TEST_OUTCOMES,
    allSteps,
    asksForNote,
    planProgress,
    planToMarkdown,
    stepState,
    stepToMarkdown
} from '@adecore/plan';
import type { Plan, PlanItem, PlanSection, PlanStep, PlanStepState } from '@adecore/plan/protocol';
import { writeGenerated } from '../../../apps/ios/Scripts/generated.ts';
import { compactFixture, seeded } from './adecore-port.ts';

/*
 * The cases the phone's plan outline is held to, with the answer `@adecore/plan` gives: the state a parent adds up to,
 * the progress counts, the lists of states a person picks from, and the Markdown a plan is copied as.
 */
const destination = resolve(import.meta.dir, '../../../apps/ios/Tests/Fixtures/ports-plan.json');

const STATES: PlanStepState[] = ['open', 'active', 'done', 'failed', 'skipped', 'blocked', 'warning', 'info'];

function leaf(id: string, state?: PlanStepState, extra: Partial<PlanStep> = {}): PlanStep {
    return { type: 'step', id, title: `Step ${id}`, ...(state === undefined ? {} : { state }), ...extra };
}

function parentOf(states: readonly PlanStepState[]): PlanStep {
    return { type: 'step', id: 'p', title: 'Parent', steps: states.map((state, index) => leaf(`c${index}`, state)) };
}

// Every list of up to three child states, in order, since the order must not matter.
const derivedLists: PlanStepState[][] = [];

for (const first of STATES) {
    derivedLists.push([first]);

    for (const second of STATES) {
        derivedLists.push([first, second]);

        for (const third of STATES) {
            derivedLists.push([first, second, third]);
        }
    }
}

derivedLists.push(['skipped', 'skipped', 'warning', 'info'], ['info', 'info', 'info', 'open'], ['done', 'skipped', 'info', 'warning', 'done']);

const derived = derivedLists.map((states) => ({ states, state: stepState(parentOf(states)) }));

// A leaf with no stored state reads as open.
const leafStates = [undefined, ...STATES].map((state) => ({ state: state ?? null, read: stepState(leaf('l', state)) }));

// `isFinishedOutcome` is not exported; a leaf counts as finished for every outcome but failed, and failed counts apart.
const finished = STATES.map((state) => {
    const progress = planProgress([leaf('l', state)]);

    return { state, finished: progress.finished === 1 && state !== 'failed' };
});

const stateTables = {
    person: [...PLAN_PERSON_STATES],
    test: [...PLAN_TEST_OUTCOMES],
    asksForNote: STATES.filter(asksForNote),
    markers: PLAN_STATE_MARKERS
};

const plans: Plan[] = [];
let counter = 0;

function plan(kind: 'steps' | 'test', items: PlanItem[], meta: { summary?: string; title?: string } = {}): void {
    counter += 1;
    plans.push({
        id: `plan-${counter}`,
        rev: counter,
        createdAt: '2026-09-16T10:00:00Z',
        meta: { title: meta.title ?? `Plan ${counter}`, kind, checks: 'anyone', ...(meta.summary === undefined ? {} : { summary: meta.summary }) },
        items
    });
}

plan('steps', []);
plan('steps', [leaf('a'), leaf('b', 'done'), leaf('c', 'failed', { note: 'Broke' })]);
plan('test', [leaf('a', 'warning', { note: 'Slow\nVery slow' }), leaf('b', 'info', { note: '' }), leaf('c', 'blocked'), leaf('d', 'skipped')]);
plan(
    'steps',
    [
        leaf('a', 'done'),
        {
            type: 'section',
            id: 's1',
            title: 'Section',
            description: 'About it',
            items: [{ type: 'text', id: 't1', title: 'Before', description: 'Read this' }]
        },
        {
            type: 'section',
            id: 's2',
            title: 'Second',
            items: [
                {
                    type: 'step',
                    id: 'p',
                    title: 'Parent',
                    description: 'First line\n\nThird line',
                    steps: [leaf('b', 'failed', { note: 'Broke' }), leaf('c', 'warning', { description: 'Check it' })]
                },
                { type: 'text', id: 't2', title: 'Note', description: 'one\ntwo\nthree' },
                leaf('x', 'active')
            ]
        },
        leaf('d'),
        { type: 'text', id: 't3', title: 'After' },
        leaf('e', 'skipped')
    ],
    { summary: 'A summary\nof two lines' }
);
plan(
    'steps',
    [
        {
            type: 'step',
            id: 'a',
            title: 'Deep',
            steps: [{ type: 'step', id: 'b', title: 'Deeper', steps: [leaf('c', 'info'), leaf('d', 'skipped')] }, leaf('e', 'done')]
        },
        { type: 'step', id: 'f', title: 'Open parent', steps: [leaf('g'), leaf('h', 'skipped')] }
    ],
    { title: 'Nested' }
);
// Lines the reader would take for markup start with a backslash.
plan(
    'steps',
    [
        {
            type: 'section',
            id: 's',
            title: 'Markup',
            description: '# not a heading\n- not a list\n> not a quote\n---\n***\n___\n\\already\n+ plus\n1. numbered\n  ## indented heading',
            items: [
                leaf('a', 'open', { description: '# heading\n\n- item\n> quote\n\\slash\n    - deep item\nplain' }),
                { type: 'text', id: 't', title: 'Bold *and* back\\slash', description: '**bold first**\nplain\n\\slash\nplain two\n> quoted' }
            ]
        },
        leaf('b', 'failed', { note: '> note\n- note\n\nlast' })
    ],
    { summary: '# Summary heading\n- summary item\nplain\n---', title: 'Title with `ticks` and #hash' }
);
plan(
    'test',
    [{ type: 'text', id: 't', title: 'Only text', description: '' }, { type: 'section', id: 's', title: 'Empty section', items: [] }, leaf('a', 'done')],
    {
        summary: ''
    }
);
plan('steps', [{ type: 'step', id: 'a', title: '日本語 \u{1f600} café', description: 'café\r\nwindows', note: 'tab\there' }], { title: 'Ångström' });

const random = seeded(77);
const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
const lines = [
    'plain',
    '# head',
    '- item',
    '> quote',
    '---',
    '',
    'two words',
    '\\slash',
    '**bold**',
    '* star',
    '\u00a0# nbsp heading',
    '\ufeff- bom item',
    '   ---',
    '####### seven',
    '#nospace',
    '-',
    '--',
    '___'
];

function randomText(): string {
    return Array.from({ length: Math.floor(random() * 4) + 1 }, () => pick(lines)).join('\n');
}

function randomSteps(prefix: string, depth: number): PlanStep[] {
    return Array.from({ length: Math.floor(random() * 3) + 1 }, (_, index) => {
        const id = `${prefix}${index}`;
        const base: PlanStep = {
            type: 'step',
            id,
            title: `Step ${id}`,
            ...(random() < 0.4 ? { description: randomText() } : {}),
            ...(random() < 0.3 ? { note: randomText() } : {})
        };

        if (depth < 2 && random() < 0.35) {
            return { ...base, steps: randomSteps(`${id}-`, depth + 1) };
        }

        return random() < 0.8 ? { ...base, state: pick(STATES) } : base;
    });
}

for (let index = 0; index < 40; index += 1) {
    const items: PlanItem[] = [];

    for (let slot = 0; slot < Math.floor(random() * 4) + 1; slot += 1) {
        const id = `i${slot}`;
        const roll = random();

        if (roll < 0.35) {
            const inner: PlanSection['items'] = randomSteps(`${id}-`, 0);

            if (random() < 0.4) {
                inner.splice(Math.floor(random() * inner.length), 0, {
                    type: 'text',
                    id: `${id}-t`,
                    title: `Text ${id}`,
                    ...(random() < 0.6 ? { description: randomText() } : {})
                });
            }

            items.push({ type: 'section', id, title: `Section ${id}`, ...(random() < 0.5 ? { description: randomText() } : {}), items: inner });
        } else if (roll < 0.5) {
            items.push({ type: 'text', id, title: `Text ${id}`, ...(random() < 0.6 ? { description: randomText() } : {}) });
        } else {
            items.push(...randomSteps(`${id}-`, 0));
        }
    }

    plan(random() < 0.5 ? 'steps' : 'test', items, random() < 0.5 ? { summary: randomText() } : {});
}

const planCases = plans.map((entry) => {
    const steps = allSteps(entry.items);

    return {
        plan: entry,
        markdown: planToMarkdown(entry),
        progress: planProgress(entry.items),
        stepStates: Object.fromEntries(steps.map((step) => [step.id, stepState(step)])),
        stepMarkdown: Object.fromEntries(steps.map((step) => [step.id, stepToMarkdown(step, (state) => `said ${state}`)]))
    };
});

const cases = {
    derived,
    leafStates,
    finished,
    tables: [stateTables],
    plans: planCases
};

await writeGenerated(new Map([[destination, compactFixture(cases)]]), `${planCases.length} plan cases`);
