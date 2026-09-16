import { describe, expect, test } from 'bun:test';
import type { Plan, PlanStepState } from '@ruimte/contracts';
import {
    activeSteps,
    activeStepsLabel,
    ancestorIds,
    asksForNote,
    foldableIds,
    nextActiveTarget,
    revealOptions,
    hasFailedStep,
    planCounter,
    planRows,
    resultsText,
    stepSetBy,
    toggledState,
    type PlanViewOptions
} from '@/plan/plan-view';

const plan: Plan = {
    id: 'plan-1',
    rev: 3,
    createdAt: '2026-09-16T13:40:00Z',
    meta: { title: 'Test the split placement', kind: 'test', checks: 'anyone' },
    items: [
        {
            type: 'section',
            id: 'split',
            title: 'Splitting a cell',
            items: [
                { type: 'text', id: 'prep', title: 'Before you start' },
                { type: 'step', id: 'new-column', title: 'A new column', state: 'done', by: 'person', at: '2026-09-16T14:02:11Z' },
                {
                    type: 'step',
                    id: 'full-grid',
                    title: 'A full grid refuses a fourth column',
                    steps: [
                        { type: 'step', id: 'no-zone', title: 'No drop zone', state: 'done' },
                        { type: 'step', id: 'focus', title: 'Focus stays', state: 'failed', note: 'Focus jumped\nto the first column.' },
                        { type: 'step', id: 'fix', title: 'Fix focus', state: 'active' }
                    ]
                }
            ]
        },
        {
            type: 'section',
            id: 'closing',
            title: 'Closing cells',
            items: [
                { type: 'step', id: 'close-one', title: 'Close one', state: 'done' },
                { type: 'step', id: 'close-two', title: 'Close two', state: 'skipped' }
            ]
        },
        { type: 'step', id: 'pixels', title: 'Whole pixels', state: 'blocked', note: 'No display' }
    ]
};

const options = (patch: Partial<PlanViewOptions> = {}): PlanViewOptions => ({ filter: 'all', collapseDone: false, collapsed: new Set(), ...patch });

const ids = (rows: ReturnType<typeof planRows>): string[] => rows.map((row) => row.item.id);

describe('the rows of a plan', () => {
    test('everything in document order, a parent with its count and whether work goes on below it', () => {
        const rows = planRows(plan, options());
        expect(ids(rows)).toEqual(['split', 'prep', 'new-column', 'full-grid', 'no-zone', 'focus', 'fix', 'closing', 'close-one', 'close-two', 'pixels']);
        const parent = rows.find((row) => row.item.id === 'full-grid');
        expect(parent).toMatchObject({ type: 'step', state: 'failed', activeBelow: true, progress: { finished: 2, total: 3 } });
        expect(rows.find((row) => row.item.id === 'focus')).toMatchObject({ depth: 1, progress: null });
    });

    test('a folded parent hides its steps', () => {
        expect(ids(planRows(plan, options({ collapsed: new Set(['full-grid', 'closing']) })))).toEqual([
            'split',
            'prep',
            'new-column',
            'full-grid',
            'closing',
            'pixels'
        ]);
    });

    test('Open keeps the steps still to do, with their parents and sections, and no text', () => {
        expect(ids(planRows(plan, options({ filter: 'open' })))).toEqual(['split', 'full-grid', 'fix', 'pixels']);
    });

    test('Failed keeps only what failed', () => {
        expect(ids(planRows(plan, options({ filter: 'issues' })))).toEqual(['split', 'full-grid', 'focus', 'pixels']);
    });

    test('Collapse done folds what is all done or skipped and leaves the rest open', () => {
        const rows = planRows(plan, options({ collapseDone: true }));
        expect(ids(rows)).toEqual(['split', 'prep', 'new-column', 'full-grid', 'no-zone', 'focus', 'fix', 'closing', 'pixels']);
        expect(rows.find((row) => row.item.id === 'closing')).toMatchObject({ collapsed: true });
    });
});

describe('what the plan says in a line', () => {
    test('collapse all folds every section and parent step, never a leaf', () => {
        expect(foldableIds(plan)).toEqual(['split', 'full-grid', 'closing']);
    });

    test('the counter counts steps with an outcome', () => {
        expect(planCounter(plan)).toBe('5/7');
        expect(hasFailedStep(plan)).toBe(true);
    });

    test('a click in a steps plan checks a step off and back', () => {
        expect(toggledState('open')).toBe('done');
        expect(toggledState('active')).toBe('done');
        expect(toggledState('done')).toBe('open');
    });

    test('the results for the chat name every failed and blocked step with its note', () => {
        expect(resultsText(plan)).toBe(
            'Results of the plan "Test the split placement":\n\nFailed:\n- Focus stays: Focus jumped to the first column.\n\nBlocked:\n- Whole pixels: No display'
        );
    });

    test('a person keeps a short line in the row, an agent only a tooltip', () => {
        expect(stepSetBy({ by: 'person' }, 'done', 'Claude', '14:02')).toEqual({ text: 'you · 14:02', tooltip: null });
        expect(stepSetBy({ by: 'agent' }, 'done', 'Claude', '19:40')).toEqual({ text: null, tooltip: 'Claude set it at 19:40' });
        expect(stepSetBy({ by: 'agent' }, 'failed', 'Claude', '')).toEqual({ text: null, tooltip: 'Claude set it' });
        expect(stepSetBy({ by: 'agent' }, 'open', 'Claude', '19:40')).toEqual({ text: null, tooltip: null });
        expect(stepSetBy({}, 'done', 'Claude', '19:40')).toEqual({ text: null, tooltip: null });
    });

    test('the results name warning and info steps after failed and blocked ones', () => {
        const items: Plan['items'] = [
            { type: 'step', id: 'one', title: 'One', state: 'info', note: 'Slow on a cold start' },
            { type: 'step', id: 'two', title: 'Two', state: 'warning' },
            { type: 'step', id: 'three', title: 'Three', state: 'failed' }
        ];
        expect(resultsText({ ...plan, items })).toBe(
            'Results of the plan "Test the split placement":\n\nFailed:\n- Three\n\nWarning:\n- Two\n\nInfo:\n- One: Slow on a cold start'
        );
    });

    test('failed, warning and info open the note, the other states do not', () => {
        const noting: PlanStepState[] = ['failed', 'warning', 'info'];
        const silent: PlanStepState[] = ['open', 'active', 'done', 'skipped', 'blocked'];
        expect(noting.every(asksForNote)).toBe(true);
        expect(silent.some(asksForNote)).toBe(false);
    });

    test('no results when nothing failed or is blocked', () => {
        expect(resultsText({ ...plan, items: [{ type: 'step', id: 'one', title: 'One', state: 'done' }] })).toBeNull();
    });
});

describe('the active steps', () => {
    const two = { items: [...plan.items, { type: 'step' as const, id: 'last', title: 'Last', state: 'active' as const }] };

    test('in document order, named by the first', () => {
        expect(activeSteps(two).map((step) => step.id)).toEqual(['fix', 'last']);
        expect(activeStepsLabel(activeSteps(plan))).toBe('Fix focus');
        expect(activeStepsLabel(activeSteps(two))).toBe('Fix focus and 1 more');
    });

    test('a click goes to the first, the next click to the one after it, then around', () => {
        const steps = activeSteps(two);
        expect(nextActiveTarget(steps, null)).toBe('fix');
        expect(nextActiveTarget(steps, 'fix')).toBe('last');
        expect(nextActiveTarget(steps, 'last')).toBe('fix');
        expect(nextActiveTarget(steps, 'gone')).toBe('fix');
        expect(nextActiveTarget([], null)).toBeNull();
    });
});

describe('revealing a step', () => {
    test('the folds around an item, outermost first', () => {
        expect(ancestorIds(plan, 'fix')).toEqual(['split', 'full-grid']);
        expect(ancestorIds(plan, 'pixels')).toEqual([]);
        expect(ancestorIds(plan, 'nope')).toBeNull();
    });

    test('opens the folds around it and keeps the others', () => {
        const next = revealOptions(plan, options({ collapsed: new Set(['split', 'full-grid', 'closing']) }), 'fix');
        expect([...next.collapsed]).toEqual(['closing']);
        expect(next.filter).toBe('all');
    });

    test('keeps a filter that already shows it', () => {
        expect(revealOptions(plan, options({ filter: 'open' }), 'fix').filter).toBe('open');
    });

    test('lets go of a filter that hides it', () => {
        expect(revealOptions(plan, options({ filter: 'issues' }), 'fix').filter).toBe('all');
    });

    test('lets go of Collapse done only when it hides the step', () => {
        const done = {
            items: [{ type: 'section' as const, id: 's', title: 'S', items: [{ type: 'step' as const, id: 'a', title: 'A', state: 'done' as const }] }]
        };
        expect(revealOptions(done, options({ collapseDone: true }), 'a').collapseDone).toBe(false);
        expect(revealOptions(plan, options({ collapseDone: true }), 'fix').collapseDone).toBe(true);
    });
});
