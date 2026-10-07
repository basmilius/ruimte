import { describe, expect, test } from 'bun:test';
import { dragging, setDragging, VIEW_DRAG_TYPE } from '@/shell/view-drag';
import { carriesDiff, DIFF_DRAG_ID, DIFF_DRAG_TYPE, droppedDiff, startDiffDrag } from './diff-drag.ts';

function transfer(data: Record<string, string> = {}): DataTransfer {
    const store = new Map(Object.entries(data));
    return {
        get types() {
            return [...store.keys()];
        },
        getData: (type: string) => store.get(type) ?? '',
        setData: (type: string, value: string) => {
            store.set(type, value);
        },
        effectAllowed: 'all'
    } as unknown as DataTransfer;
}

const diff = { path: '/repo/src/main.ts', view: { kind: 'diff' as const, cwd: '/repo', scope: 'worktree' as const, staged: false } };

describe('a change dragged out of the git panel', () => {
    test('travels as a drag of no view of the grid, with the change it opens', () => {
        const carried = transfer();
        startDiffDrag(carried, diff);
        expect(carried.getData(VIEW_DRAG_TYPE)).toBe(DIFF_DRAG_ID);
        expect(dragging()).toBe(DIFF_DRAG_ID);
        expect(carriesDiff(carried)).toBe(true);
        expect(droppedDiff(carried)).toEqual(diff);
        setDragging(null);
    });

    test('a payload this window cannot read is no change', () => {
        expect(droppedDiff(transfer())).toBeNull();
        expect(droppedDiff(transfer({ [DIFF_DRAG_TYPE]: 'not json' }))).toBeNull();
        expect(droppedDiff(transfer({ [DIFF_DRAG_TYPE]: JSON.stringify({ path: '/repo/a', view: { kind: 'file' } }) }))).toBeNull();
    });
});
