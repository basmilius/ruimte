import { expect, test } from 'bun:test';
import type { ProjectLocal } from '@ruimte/contracts';
import { viewIdsIn } from '@/layout/split';
import { withoutSessionLayout } from './session-local.ts';

test('cuts the cells of session tabs and keeps ordinary loose tabs and the unknown keys of the layout', () => {
    const local: ProjectLocal = {
        activeViewId: 'snapshot:a',
        views: {},
        layout: {
            future: { keep: true },
            columns: [{ size: 1, cells: [{ size: 1, viewId: 'snapshot:a', tabs: ['canvas', '/repo/file.ts', 'snapshot:a'] }] }],
            focus: { column: 0, cell: 0 }
        } as ProjectLocal['layout']
    };

    const result = withoutSessionLayout(local, new Set(['snapshot:a']), ['canvas']);

    expect(viewIdsIn(result.layout!)).toEqual(['canvas', '/repo/file.ts']);
    expect(result.layout).toMatchObject({ future: { keep: true } });
    expect(result.activeViewId).not.toBe('snapshot:a');
    expect(result.activeViewId).toBe(result.layout!.columns[0]!.cells[0]!.viewId);
});

test('leaves a layout that holds no session tab as it is', () => {
    const local: ProjectLocal = {
        activeViewId: 'canvas',
        views: {},
        layout: { columns: [{ size: 1, cells: [{ size: 1, viewId: 'canvas' }] }], focus: { column: 0, cell: 0 } }
    };

    expect(withoutSessionLayout(local, new Set(['compare:a']), ['canvas'])).toBe(local);
});

test('falls back to the first view of the project when only a session tab stood in the layout', () => {
    const local: ProjectLocal = {
        activeViewId: 'compare:a',
        views: {},
        layout: { columns: [{ size: 1, cells: [{ size: 1, viewId: 'compare:a' }] }], focus: { column: 0, cell: 0 } }
    };

    const result = withoutSessionLayout(local, new Set(['compare:a']), ['canvas']);

    expect(viewIdsIn(result.layout!)).toEqual(['canvas']);
    expect(result.activeViewId).toBe('canvas');
});

test('writes an explicitly empty layout when nothing is left to stand in it', () => {
    const local: ProjectLocal = {
        activeViewId: 'compare:a',
        views: {},
        layout: { columns: [{ size: 1, cells: [{ size: 1, viewId: 'compare:a' }] }], focus: { column: 0, cell: 0 } }
    };

    expect(withoutSessionLayout(local, new Set(['compare:a']), [])).toEqual({ activeViewId: null, views: {}, emptyLayout: true });
});
