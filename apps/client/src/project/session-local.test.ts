import { expect, test } from 'bun:test';
import type { ProjectLocal } from '@ruimte/contracts';
import { viewIdsIn } from '@/shell/split';
import { withoutSessionLayout } from './session-local';

test('removing temporary layout keys retains regular loose tabs and unknown layout fields', () => {
    const local: ProjectLocal = {
        activeViewId: 'snapshot:a',
        views: {},
        layout: {
            ...{ future: { keep: true } },
            columns: [{ size: 1, cells: [{ size: 1, viewId: 'snapshot:a', tabs: ['canvas', '/repo/file.ts', 'snapshot:a'] }] }],
            focus: { column: 0, cell: 0 }
        }
    };
    const result = withoutSessionLayout(local, new Set(['snapshot:a']), ['canvas']);
    expect(viewIdsIn(result.layout!)).toEqual(['canvas', '/repo/file.ts']);
    expect(result.layout).toMatchObject({ future: { keep: true } });
    expect(result.activeViewId).toBe(result.layout!.columns[0]!.cells[0]!.viewId);
    expect(result.activeViewId).not.toBe('snapshot:a');
    expect(withoutSessionLayout(local, new Set(['unplaced']), ['canvas'])).toBe(local);
});

test('closing the only session tab exports an explicitly empty layout', () => {
    const result = withoutSessionLayout(
        {
            activeViewId: 'compare:a',
            views: {},
            layout: {
                columns: [{ size: 1, cells: [{ size: 1, viewId: 'compare:a' }] }],
                focus: { column: 0, cell: 0 }
            }
        },
        new Set(['compare:a']),
        []
    );
    expect(result).toEqual({ activeViewId: null, views: {}, emptyLayout: true });
});
