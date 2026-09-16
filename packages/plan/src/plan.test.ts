import { describe, expect, test } from 'bun:test';
import type { Plan, PlanActor, PlanChecks, PlanItem, PlanOp, PlanStep, PlanStepState } from '@ruimte/contracts';
import {
    applyPlanOps,
    canApply,
    createPlan,
    deriveState,
    findItem,
    parsePlanDraft,
    parsePlanMarkdown,
    planProgress,
    planToMarkdown,
    renderPlanText,
    stepState,
    validatePlan,
    type PlanApplied,
    type PlanDraft,
    type PlanRefusal
} from './index.ts';

const NOW = '2026-09-16T14:30:00Z';

const counterMint = (): (() => string) => {
    let next = 0;
    return () => `m${++next}`;
};

const step = (id: string, extra: Partial<PlanStep> = {}): PlanStep => ({ type: 'step', id, title: `Step ${id}`, ...extra });

const planOf = (items: PlanItem[], meta: Partial<Plan['meta']> = {}): Plan => ({
    id: 'plan-1',
    rev: 3,
    createdAt: '2026-09-16T13:40:00Z',
    meta: { title: 'Plan', kind: 'steps', checks: 'anyone', ...meta },
    items
});

const apply = (plan: Plan, ops: PlanOp[], actor: PlanActor): PlanApplied | PlanRefusal => applyPlanOps(plan, ops, { actor, now: NOW, mintId: counterMint() });

const applied = (result: PlanApplied | PlanRefusal): PlanApplied => {
    if (!result.ok) {
        throw new Error(`Refused ${result.code}: ${result.message}`);
    }
    return result;
};

const codeOf = (result: { ok: boolean; code?: string }): string | undefined => (result.ok ? undefined : result.code);

const stepIn = (plan: Plan, id: string): PlanStep => findItem(plan, id) as PlanStep;

describe('who may set a step', () => {
    const rows: { checks: PlanChecks; agent: string | undefined; person: string | undefined }[] = [
        { checks: 'anyone', agent: undefined, person: undefined },
        { checks: 'agent', agent: undefined, person: 'step-locked' },
        { checks: 'person', agent: 'person-only', person: undefined }
    ];
    for (const row of rows) {
        for (const actor of ['agent', 'person'] as const) {
            test(`${row.checks} step set by the ${actor}`, () => {
                const plan = planOf([step('a', { checks: row.checks })]);
                const op: PlanOp = { op: 'set', ids: ['a'], state: 'done' };
                const expected = row[actor];
                expect(codeOf(canApply(op, actor, plan))).toBe(expected);
                const result = apply(plan, [op], actor);
                expect(codeOf(result)).toBe(expected);
                if (result.ok) {
                    expect(stepIn(result.plan, 'a')).toMatchObject({ state: 'done', by: actor, at: NOW });
                    expect(result.plan.rev).toBe(4);
                }
            });
        }
        test(`a plan whose default is ${row.checks} applies it to steps without their own checks`, () => {
            const plan = planOf([step('a')], { checks: row.checks });
            const op: PlanOp = { op: 'set', ids: ['a'], state: 'done' };
            expect(codeOf(canApply(op, 'agent', plan))).toBe(row.agent);
            expect(codeOf(canApply(op, 'person', plan))).toBe(row.person);
        });
    }

    test('a person unlocks an agent step, which then anyone sets', () => {
        const plan = planOf([step('a', { checks: 'agent' })]);
        const unlocked = applied(apply(plan, [{ op: 'unlock', ids: ['a'] }], 'person')).plan;
        expect(stepIn(unlocked, 'a').unlocked).toBe(true);
        expect(codeOf(apply(unlocked, [{ op: 'set', ids: ['a'], state: 'done' }], 'person'))).toBeUndefined();
        expect(codeOf(apply(unlocked, [{ op: 'set', ids: ['a'], state: 'done' }], 'agent'))).toBeUndefined();
    });

    test('unlock all lifts every agent lock and leaves person steps alone', () => {
        const plan = planOf([step('a', { checks: 'agent' }), step('b', { checks: 'person' }), step('c', { steps: [step('d')] })], { checks: 'agent' });
        const unlocked = applied(apply(plan, [{ op: 'unlock', ids: 'all' }], 'person')).plan;
        expect(stepIn(unlocked, 'a').unlocked).toBe(true);
        expect(stepIn(unlocked, 'b').unlocked).toBeUndefined();
        expect(stepIn(unlocked, 'd').unlocked).toBe(true);
    });

    test('an agent never locks an unlocked step again', () => {
        const plan = planOf([step('a', { checks: 'agent', unlocked: true })]);
        expect(codeOf(apply(plan, [{ op: 'edit', id: 'a', checks: 'agent' }], 'agent'))).toBe('unlocked-by-person');
        expect(codeOf(apply(plan, [{ op: 'edit', id: 'a', checks: 'person' }], 'agent'))).toBe('unlocked-by-person');
        expect(codeOf(apply(plan, [{ op: 'unlock', ids: ['a'] }], 'agent'))).toBe('op-not-allowed');
    });

    test('an agent does not loosen a person step', () => {
        const plan = planOf([step('a', { checks: 'person' }), step('b')], { checks: 'person' });
        expect(codeOf(apply(plan, [{ op: 'edit', id: 'a', checks: 'anyone' }], 'agent'))).toBe('person-only');
        expect(codeOf(apply(plan, [{ op: 'meta', checks: 'anyone' }], 'agent'))).toBe('person-only');
        expect(codeOf(apply(plan, [{ op: 'edit', id: 'a', title: 'Renamed' }], 'agent'))).toBeUndefined();
    });

    test('an agent never changes a state a person set, but may repeat it or add a note', () => {
        const plan = planOf([step('a', { state: 'failed', by: 'person', at: '2026-09-16T14:00:00Z' })]);
        expect(codeOf(apply(plan, [{ op: 'set', ids: ['a'], state: 'done' }], 'agent'))).toBe('set-by-person');
        expect(codeOf(apply(plan, [{ op: 'set', ids: ['a'], state: 'active' }], 'agent'))).toBe('set-by-person');
        const same = applied(apply(plan, [{ op: 'set', ids: ['a'], state: 'failed', note: 'Fixed in abc123' }], 'agent')).plan;
        expect(stepIn(same, 'a')).toMatchObject({ state: 'failed', by: 'person', at: '2026-09-16T14:00:00Z', note: 'Fixed in abc123' });
        const noted = applied(apply(plan, [{ op: 'note', id: 'a', text: 'Looking' }], 'agent')).plan;
        expect(stepIn(noted, 'a').note).toBe('Looking');
    });

    test('a person overrides a state the agent set', () => {
        const plan = planOf([step('a', { state: 'done', by: 'agent', at: NOW })]);
        const result = applied(apply(plan, [{ op: 'set', ids: ['a'], state: 'failed', note: 'Broken' }], 'person')).plan;
        expect(stepIn(result, 'a')).toMatchObject({ state: 'failed', by: 'person', note: 'Broken' });
    });

    test('a person only checks off, notes and unlocks', () => {
        const plan = planOf([step('a'), step('b')]);
        const structural: PlanOp[] = [
            { op: 'add', type: 'step', title: 'New' },
            { op: 'edit', id: 'a', title: 'Renamed' },
            { op: 'move', id: 'a', after: 'b' },
            { op: 'remove', id: 'a' },
            { op: 'meta', status: 'Busy' },
            { op: 'set', ids: ['a'], state: 'done', next: 'b' }
        ];
        for (const op of structural) {
            expect(codeOf(apply(plan, [op], 'person'))).toBe('op-not-allowed');
        }
    });

    test('a batch is all or nothing', () => {
        const plan = planOf([step('a'), step('b', { checks: 'person' })]);
        const result = apply(
            plan,
            [
                { op: 'set', ids: ['a'], state: 'done' },
                { op: 'set', ids: ['b'], state: 'done' }
            ],
            'agent'
        );
        expect(codeOf(result)).toBe('person-only');
        expect(stepIn(plan, 'a').state).toBeUndefined();
    });

    test('an id that is gone is refused', () => {
        const plan = planOf([step('a')]);
        expect(codeOf(apply(plan, [{ op: 'set', ids: ['gone'], state: 'done' }], 'person'))).toBe('plan-missing-item');
        expect(codeOf(apply(plan, [{ op: 'note', id: 'gone', text: 'x' }], 'person'))).toBe('plan-missing-item');
        expect(codeOf(apply(plan, [{ op: 'remove', id: 'gone' }], 'agent'))).toBe('plan-missing-item');
    });

    test('a parent has no state of its own to set', () => {
        const plan = planOf([step('a', { steps: [step('b')] })]);
        expect(codeOf(apply(plan, [{ op: 'set', ids: ['a'], state: 'done' }], 'person'))).toBe('plan-parent-state');
    });
});

describe('next', () => {
    test('sets one step done and the next active in one rev', () => {
        const plan = planOf([step('build', { state: 'active', by: 'agent', at: NOW }), step('tests')]);
        const result = applied(apply(plan, [{ op: 'set', ids: ['build'], state: 'done', next: 'tests' }], 'agent')).plan;
        expect(result.rev).toBe(plan.rev + 1);
        expect(stepState(stepIn(result, 'build'))).toBe('done');
        expect(stepState(stepIn(result, 'tests'))).toBe('active');
    });

    test('follows the same rules for the next step', () => {
        const plan = planOf([step('build'), step('tests', { checks: 'person' })]);
        expect(codeOf(apply(plan, [{ op: 'set', ids: ['build'], state: 'done', next: 'tests' }], 'agent'))).toBe('person-only');
    });
});

describe('removing', () => {
    test('refuses a step a person checked', () => {
        const plan = planOf([step('a', { state: 'done', by: 'person', at: NOW })]);
        expect(codeOf(apply(plan, [{ op: 'remove', id: 'a' }], 'agent'))).toBe('set-by-person');
    });

    test('refuses a parent above a step a person checked', () => {
        const plan = planOf([
            {
                type: 'section',
                id: 'split',
                title: 'Split',
                items: [step('grid', { steps: [step('zone'), step('focus', { steps: [step('deep', { state: 'failed', by: 'person', at: NOW })] })] })]
            }
        ]);
        expect(codeOf(apply(plan, [{ op: 'remove', id: 'focus' }], 'agent'))).toBe('set-by-person');
        expect(codeOf(apply(plan, [{ op: 'remove', id: 'grid' }], 'agent'))).toBe('set-by-person');
        expect(codeOf(apply(plan, [{ op: 'remove', id: 'split' }], 'agent'))).toBe('set-by-person');
        const removed = applied(apply(plan, [{ op: 'remove', id: 'zone' }], 'agent')).plan;
        expect(findItem(removed, 'zone')).toBeNull();
    });

    test('allows what the agent set itself', () => {
        const plan = planOf([step('a', { steps: [step('b', { state: 'done', by: 'agent', at: NOW })] })]);
        const result = applied(apply(plan, [{ op: 'remove', id: 'a' }], 'agent')).plan;
        expect(result.items).toEqual([]);
    });
});

describe('structure', () => {
    test('a step that gets its first sub-step loses its state and says so', () => {
        const plan = planOf([step('a', { state: 'done', by: 'agent', at: NOW })]);
        const result = applied(apply(plan, [{ op: 'add', type: 'step', title: 'Sub', under: 'a' }], 'agent'));
        expect(result.dropped).toEqual(['a']);
        expect(result.minted).toEqual(['m1']);
        const parent = stepIn(result.plan, 'a');
        expect(parent.state).toBeUndefined();
        expect(parent.by).toBeUndefined();
        expect(parent.steps).toEqual([{ type: 'step', id: 'm1', title: 'Sub' }]);
    });

    test('a sub-step under a state a person set is refused', () => {
        const plan = planOf([step('a', { state: 'done', by: 'person', at: NOW }), step('b')]);
        expect(codeOf(apply(plan, [{ op: 'add', type: 'step', title: 'Sub', under: 'a' }], 'agent'))).toBe('set-by-person');
        expect(codeOf(apply(plan, [{ op: 'move', id: 'b', under: 'a' }], 'agent'))).toBe('set-by-person');
    });

    test('adds after an item beside it and mints ids that are free', () => {
        const plan = planOf([step('m1'), step('b')]);
        const result = applied(apply(plan, [{ op: 'add', type: 'step', title: 'Between', after: 'm1' }], 'agent'));
        expect(result.plan.items.map((item) => item.id)).toEqual(['m1', 'm2', 'b']);
    });

    test('refuses an id that is taken', () => {
        const plan = planOf([step('a')]);
        expect(codeOf(apply(plan, [{ op: 'add', type: 'step', id: 'a', title: 'Again' }], 'agent'))).toBe('duplicate-id');
    });

    test('keeps sections at the top and text out of steps', () => {
        const plan = planOf([{ type: 'section', id: 's', title: 'S', items: [] }, step('a'), { type: 'text', id: 't', title: 'T' }]);
        expect(codeOf(apply(plan, [{ op: 'add', type: 'section', title: 'Inner', under: 's' }], 'agent'))).toBe('plan-bad-position');
        expect(codeOf(apply(plan, [{ op: 'add', type: 'text', title: 'Note', under: 'a' }], 'agent'))).toBe('plan-bad-position');
        expect(codeOf(apply(plan, [{ op: 'add', type: 'step', title: 'Sub', under: 't' }], 'agent'))).toBe('plan-bad-position');
    });

    test('moves an item and never into itself', () => {
        const plan = planOf([step('a', { steps: [step('b')] }), step('c')]);
        expect(codeOf(apply(plan, [{ op: 'move', id: 'a', under: 'b' }], 'agent'))).toBe('plan-bad-position');
        const moved = applied(apply(plan, [{ op: 'move', id: 'b', after: 'c' }], 'agent')).plan;
        expect(moved.items.map((item) => item.id)).toEqual(['a', 'c', 'b']);
        expect(stepIn(moved, 'a').steps).toBeUndefined();
    });

    test('edits and clears text and meta', () => {
        const plan = planOf([step('a', { description: 'Old' })], { status: 'Busy' });
        const result = applied(
            apply(
                plan,
                [
                    { op: 'edit', id: 'a', title: 'New', description: '' },
                    { op: 'meta', status: '', summary: 'About' }
                ],
                'agent'
            )
        ).plan;
        expect(stepIn(result, 'a')).toEqual({ type: 'step', id: 'a', title: 'New' });
        expect(result.meta).toEqual({ title: 'Plan', kind: 'steps', checks: 'anyone', summary: 'About' });
    });

    const nested = (levels: number): PlanStep => {
        let current = step(`l${levels}`);
        for (let level = levels - 1; level >= 1; level--) {
            current = step(`l${level}`, { steps: [current] });
        }
        return current;
    };

    test('five levels of steps are allowed and six are refused', () => {
        expect(validatePlan(planOf([nested(5)])).ok).toBe(true);
        expect(codeOf(validatePlan(planOf([nested(6)])))).toBe('plan-too-deep');
        expect(codeOf(apply(planOf([nested(5)]), [{ op: 'add', type: 'step', title: 'Deeper', under: 'l5' }], 'agent'))).toBe('plan-too-deep');
        const draft = (levels: number): PlanDraft => ({ meta: { title: 'Deep' }, items: [nested(levels)] as PlanDraft['items'] });
        expect(createPlan(draft(5), { id: 'p', now: NOW }).ok).toBe(true);
        expect(codeOf(createPlan(draft(6), { id: 'p', now: NOW }))).toBe('plan-too-deep');
    });

    test('300 items are allowed and 301 are refused', () => {
        const items = (count: number): PlanItem[] => Array.from({ length: count }, (_, index) => step(`s${index}`));
        expect(validatePlan(planOf(items(300))).ok).toBe(true);
        expect(codeOf(validatePlan(planOf(items(301))))).toBe('plan-too-large');
        expect(codeOf(apply(planOf(items(300)), [{ op: 'add', type: 'text', title: 'One more' }], 'agent'))).toBe('plan-too-large');
        expect(codeOf(createPlan({ meta: { title: 'Big' }, items: items(301) as PlanDraft['items'] }, { id: 'p', now: NOW }))).toBe('plan-too-large');
    });

    test('limits on text are the schema', () => {
        const plan = planOf([step('a')]);
        expect(codeOf(apply(plan, [{ op: 'note', id: 'a', text: 'x'.repeat(501) }], 'person'))).toBe('plan-invalid');
        expect(codeOf(apply(plan, [{ op: 'add', type: 'step', id: 'Bad Id', title: 'x' }], 'agent'))).toBe('plan-invalid');
        expect(codeOf(apply(plan, [{ op: 'meta', status: 'x'.repeat(201) }], 'agent'))).toBe('plan-invalid');
    });
});

describe('derived state', () => {
    const PAIRS: [PlanStepState, PlanStepState, PlanStepState][] = [
        ['open', 'open', 'open'],
        ['open', 'active', 'active'],
        ['open', 'done', 'active'],
        ['open', 'failed', 'failed'],
        ['open', 'skipped', 'open'],
        ['open', 'blocked', 'blocked'],
        ['active', 'active', 'active'],
        ['active', 'done', 'active'],
        ['active', 'failed', 'failed'],
        ['active', 'skipped', 'active'],
        ['active', 'blocked', 'blocked'],
        ['done', 'done', 'done'],
        ['done', 'failed', 'failed'],
        ['done', 'skipped', 'done'],
        ['done', 'blocked', 'blocked'],
        ['failed', 'failed', 'failed'],
        ['failed', 'skipped', 'failed'],
        ['failed', 'blocked', 'failed'],
        ['skipped', 'skipped', 'done'],
        ['skipped', 'blocked', 'blocked'],
        ['blocked', 'blocked', 'blocked']
    ];

    for (const [first, second, expected] of PAIRS) {
        test(`${first} and ${second} make ${expected}`, () => {
            expect(deriveState([first, second])).toBe(expected);
            expect(deriveState([second, first])).toBe(expected);
        });
    }

    test('one child passes its state up', () => {
        for (const state of ['open', 'active', 'done', 'failed', 'blocked'] as const) {
            expect(deriveState([state])).toBe(state);
        }
        expect(deriveState(['skipped'])).toBe('done');
    });

    test('failed goes before blocked in any mix', () => {
        expect(deriveState(['done', 'skipped', 'blocked', 'failed', 'active', 'open'])).toBe('failed');
        expect(deriveState(['done', 'skipped', 'open'])).toBe('active');
    });

    test('a parent of parents derives from what its children derive', () => {
        const tree = step('a', {
            steps: [step('b', { steps: [step('c', { state: 'done' }), step('d', { state: 'skipped' })] }), step('e', { state: 'done' })]
        });
        expect(stepState(tree)).toBe('done');
        const open = step('a', { steps: [step('b', { steps: [step('c'), step('d', { state: 'skipped' })] }), step('e', { state: 'skipped' })] });
        expect(stepState(open)).toBe('open');
    });

    test('progress counts leaf steps only', () => {
        const progress = planProgress([
            { type: 'text', id: 't', title: 'T' },
            step('a', { steps: [step('b', { state: 'done' }), step('c', { state: 'failed' })] }),
            step('d', { state: 'active' })
        ]);
        expect(progress).toEqual({ total: 3, open: 0, active: 1, done: 1, failed: 1, skipped: 0, blocked: 0, finished: 2 });
    });
});

describe('a new plan', () => {
    test('refuses a field it does not know by its path', () => {
        const result = parsePlanDraft({ meta: { title: 'T' }, items: [{ type: 'step', title: 'A', stat: 'done' }] });
        expect(codeOf(result)).toBe('plan-invalid');
        expect(result.ok ? '' : result.message).toContain('items[0]');
        expect(codeOf(parsePlanDraft({ items: [{ type: 'step', title: 'A', by: 'person' }] }))).toBe('plan-invalid');
        expect(codeOf(parsePlanDraft({ items: [], rev: 1 }))).toBe('plan-invalid');
    });

    test('mints ids, marks states as the agent and takes flags over the draft', () => {
        const parsed = parsePlanDraft({
            meta: { title: 'Draft', kind: 'test' },
            items: [
                {
                    type: 'section',
                    title: 'S',
                    items: [
                        { type: 'step', id: 'keep', title: 'A', state: 'done' },
                        { type: 'text', title: 'T' }
                    ]
                }
            ]
        });
        if (!parsed.ok) {
            throw new Error(parsed.message);
        }
        const result = applied(createPlan(parsed.draft, { id: 'plan-9', now: NOW, mintId: counterMint(), meta: { title: 'Flag' } }));
        expect(result.minted).toEqual(['m1', 'm2']);
        expect(result.plan).toEqual({
            id: 'plan-9',
            rev: 0,
            createdAt: NOW,
            meta: { title: 'Flag', kind: 'test', checks: 'anyone' },
            items: [
                {
                    type: 'section',
                    id: 'm1',
                    title: 'S',
                    items: [
                        { type: 'step', id: 'keep', title: 'A', state: 'done', by: 'agent', at: NOW },
                        { type: 'text', id: 'm2', title: 'T' }
                    ]
                }
            ]
        });
    });

    test('refuses a state on a person step, a duplicate id and a missing title', () => {
        expect(
            codeOf(createPlan({ meta: { title: 'T', checks: 'person' }, items: [{ type: 'step', title: 'A', state: 'done' }] }, { id: 'p', now: NOW }))
        ).toBe('person-only');
        expect(
            codeOf(
                createPlan(
                    {
                        meta: { title: 'T' },
                        items: [
                            { type: 'step', id: 'a', title: 'A' },
                            { type: 'step', id: 'a', title: 'B' }
                        ]
                    },
                    { id: 'p', now: NOW }
                )
            )
        ).toBe('duplicate-id');
        expect(codeOf(createPlan({ items: [] }, { id: 'p', now: NOW }))).toBe('plan-invalid');
    });
});

const EXAMPLE: Plan = {
    id: 'plan-7f3a',
    rev: 14,
    createdAt: '2026-09-16T13:40:00Z',
    meta: {
        title: 'Test the split placement',
        kind: 'test',
        summary: 'Run in the Electron dev app.',
        status: 'Fixing focus after a refused drop',
        checks: 'anyone'
    },
    items: [
        {
            type: 'section',
            id: 'split',
            title: 'Splitting a cell',
            description: 'Run in the Electron dev app, one project with a chat view.',
            items: [
                { type: 'text', id: 'prep', title: 'Before you start', description: 'Close every split so the project shows one cell.' },
                step('new-column', {
                    title: 'Dragging a view right makes a new column',
                    checks: 'person',
                    state: 'done',
                    by: 'person',
                    at: '2026-09-16T14:02:11Z'
                }),
                step('full-grid', {
                    title: 'A full grid refuses a fourth column',
                    description: 'Three columns, drag a fourth view in.',
                    steps: [
                        step('no-zone', { title: 'No drop zone on the edge', state: 'done', by: 'person' }),
                        step('focus', { title: 'Focus stays where it was', state: 'failed', note: 'Focus jumped to the first column.', by: 'person' })
                    ]
                }),
                step('fix-focus', { title: 'Fix focus after a refused drop', checks: 'agent', state: 'active', by: 'agent', at: NOW }),
                step('pixels', { title: 'Resizing keeps whole pixels' })
            ]
        },
        {
            type: 'section',
            id: 'closing',
            title: 'Closing cells',
            items: [step('close-last', { title: 'Closing the last cell' }), step('close-middle', { title: 'Closing a middle cell' })]
        },
        step('wrap-up', { title: 'Report back', state: 'skipped', by: 'agent', at: NOW })
    ]
};

describe('plan read', () => {
    test('prints the compact text with ids, markers and who set what', () => {
        const other = {
            ...planOf([step('x', { state: 'done' })]),
            id: 'plan-2c1d',
            meta: { title: 'Split placement', kind: 'steps' as const, checks: 'anyone' as const }
        };
        const text = renderPlanText(EXAMPLE, { others: [other], formatTime: (at) => at.slice(11, 16) });
        expect(text).toBe(
            [
                'Plan "Test the split placement" (plan-7f3a, test, rev 14): 4 of 8 run, 2 passed, 1 failed, 1 skipped',
                'Status: Fixing focus after a refused drop. Now: fix-focus. Also in this chat: plan-2c1d "Split placement" (steps, 1/1)',
                '',
                '## Splitting a cell [split] 3/5',
                '  Before you start [prep]: Close every split so the project shows one cell.',
                '  [x] 1 Dragging a view right makes a new column [new-column] person-only, set by a person 14:02',
                '  [!] 2 A full grid refuses a fourth column [full-grid] 2/2',
                '    [x] 2.1 No drop zone on the edge [no-zone] set by a person',
                '    [!] 2.2 Focus stays where it was [focus] set by a person: "Focus jumped to the first column."',
                '  [~] 3 Fix focus after a refused drop [fix-focus] agent-only',
                '  [ ] 4 Resizing keeps whole pixels [pixels]',
                '',
                '## Closing cells [closing] 0/2',
                '  [ ] 1 Closing the last cell [close-last]',
                '  [ ] 2 Closing a middle cell [close-middle]',
                '',
                '[-] 1 Report back [wrap-up]'
            ].join('\n')
        );
    });
});

describe('markdown', () => {
    const withoutIds = (plan: Plan): unknown =>
        JSON.parse(JSON.stringify(plan, (key, value) => (key === 'id' || key === 'by' || key === 'at' || key === 'checks' ? undefined : value)));

    test('reads a task list an agent wrote', () => {
        const parsed = parsePlanMarkdown(
            [
                '# Ship it',
                '',
                '- [x] Build',
                '- [ ] Test',
                '  - [ ] Unit',
                '    Run bun test.',
                '  - plain item',
                '',
                '## Release',
                '',
                '> **Heads up** Needs the keychain.',
                '',
                '* [~] Tag'
            ].join('\n')
        );
        expect(parsed).toEqual({
            ok: true,
            draft: {
                meta: { title: 'Ship it' },
                items: [
                    { type: 'step', title: 'Build', state: 'done' },
                    {
                        type: 'step',
                        title: 'Test',
                        steps: [
                            { type: 'step', title: 'Unit', description: 'Run bun test.' },
                            { type: 'step', title: 'plain item' }
                        ]
                    },
                    {
                        type: 'section',
                        title: 'Release',
                        items: [
                            { type: 'text', title: 'Heads up', description: 'Needs the keychain.' },
                            { type: 'step', title: 'Tag', state: 'active' }
                        ]
                    }
                ]
            }
        });
    });

    test('refuses a line that belongs to nothing and an unknown marker', () => {
        expect(codeOf(parsePlanMarkdown('# T\n\n- [ ] A\n\nStray prose'))).toBe('plan-invalid');
        expect(codeOf(parsePlanMarkdown('- [o] A'))).toBe('plan-invalid');
    });

    test('goes out and back in to the same plan, except for ids', () => {
        const source = { ...structuredClone(EXAMPLE), rev: 0, createdAt: NOW };
        delete source.meta.status;
        const markdown = planToMarkdown(source);
        const parsed = parsePlanMarkdown(markdown);
        if (!parsed.ok) {
            throw new Error(parsed.message);
        }
        const again = applied(createPlan(parsed.draft, { id: source.id, now: NOW, meta: { kind: 'test' } })).plan;
        expect(withoutIds(again)).toEqual(withoutIds(source));
        expect(planToMarkdown(again)).toBe(markdown);
    });

    test('writes the checked states, notes and the rule back to the top', () => {
        expect(planToMarkdown(EXAMPLE)).toBe(
            [
                '# Test the split placement',
                '',
                'Run in the Electron dev app.',
                '',
                '## Splitting a cell',
                '',
                'Run in the Electron dev app, one project with a chat view.',
                '',
                '> **Before you start** Close every split so the project shows one cell.',
                '',
                '- [x] Dragging a view right makes a new column',
                '- [!] A full grid refuses a fourth column',
                '    Three columns, drag a fourth view in.',
                '    - [x] No drop zone on the edge',
                '    - [!] Focus stays where it was',
                '        > Focus jumped to the first column.',
                '- [~] Fix focus after a refused drop',
                '- [ ] Resizing keeps whole pixels',
                '',
                '## Closing cells',
                '',
                '- [ ] Closing the last cell',
                '- [ ] Closing a middle cell',
                '',
                '---',
                '',
                '- [-] Report back',
                ''
            ].join('\n')
        );
    });
});
