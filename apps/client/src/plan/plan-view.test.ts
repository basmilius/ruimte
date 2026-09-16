import { describe, expect, test } from 'bun:test';
import type { Plan } from '@ruimte/contracts';
import { hasFailedStep, planCounter, planRows, resultsText, stepSetBy, toggledState, type PlanViewOptions } from '@/plan/plan-view';

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
        expect(ids(planRows(plan, options({ filter: 'failed' })))).toEqual(['split', 'full-grid', 'focus']);
    });

    test('Collapse done folds what is all done or skipped and leaves the rest open', () => {
        const rows = planRows(plan, options({ collapseDone: true }));
        expect(ids(rows)).toEqual(['split', 'prep', 'new-column', 'full-grid', 'no-zone', 'focus', 'fix', 'closing', 'pixels']);
        expect(rows.find((row) => row.item.id === 'closing')).toMatchObject({ collapsed: true });
    });
});

describe('what the plan says in a line', () => {
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

    test('no results when nothing failed or is blocked', () => {
        expect(resultsText({ ...plan, items: [{ type: 'step', id: 'one', title: 'One', state: 'done' }] })).toBeNull();
    });
});
