import { useTopRowSlot } from '@adecore/ui';
import { cellCount } from '@/layout/split';
import { useDocument } from '@/state/document';

/*
 * The element a cell's bar goes into instead of over its body, or null where it stays on the cell: the bar
 * of the only cell joins the project in the top row. Project tabs leave the row no slot, and in a split
 * every cell keeps a bar of its own.
 */
export function useCellBarSlot(): HTMLElement | null {
    const slot = useTopRowSlot();
    const lone = useDocument((state) => state.layout !== null && cellCount(state.layout) === 1);

    return lone ? slot : null;
}
