import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FILES_VIEW_ID, filesView, type CellView } from '@/shell/files-view';
import { cellViewOf, useDocument } from '@/state/document';

/*
 * What stands in a cell, by the id the layout holds. Every surface that draws a cell asks this
 * instead of the saved view list, since file cells can be temporary.
 */
export function useCellView(viewId: string | null): CellView | null {
    const { t } = useTranslation('shell');
    const view = useDocument((state) => cellViewOf(state, viewId));
    const name = t('filesView.name');
    return useMemo(() => (viewId === FILES_VIEW_ID ? filesView(name) : view), [viewId, view, name]);
}
