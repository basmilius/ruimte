import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CellView } from '@/shell/cell-view';
import { looseTabLabel } from '@/shell/panels/tab-label';
import { cellViewOf, useDocument } from '@/state/document';
import { useFiles } from '@/state/files';

/*
 * What stands in a cell, by the id the layout holds: a view of the project, else the loose view
 * that has this key. Every surface that draws a cell asks this instead of the saved view list.
 */
export function useCellView(viewId: string | null): CellView | null {
    // The label is written in the interface's language, which re-renders this when it changes.
    useTranslation('shell');
    const view = useDocument((state) => cellViewOf(state, viewId));
    const tab = useFiles((state) => (viewId === null ? undefined : state.tabs.find((entry) => entry.key === viewId)));
    const name = tab === undefined ? null : looseTabLabel(tab);
    return useMemo(() => (view !== null || tab === undefined || name === null ? view : { kind: 'loose', id: tab.key, tab, name }), [view, tab, name]);
}
