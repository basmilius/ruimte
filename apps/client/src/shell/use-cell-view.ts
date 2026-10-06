import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { clientCellView, DATABASES_VIEW_ID, FILES_VIEW_ID, type CellView } from '@/shell/client-cells';
import { cellViewOf, useDocument } from '@/state/document';

/*
 * What stands in a cell, by the id the layout holds. Every surface that draws a cell asks this
 * instead of the saved view list, since file cells can be temporary.
 */
export function useCellView(viewId: string | null): CellView | null {
    const { t } = useTranslation(['shell', 'databases']);
    const view = useDocument((state) => cellViewOf(state, viewId));
    const files = t('shell:filesView.name');
    const databases = t('databases:cell.name');
    return useMemo(() => {
        if (viewId === FILES_VIEW_ID) {
            return clientCellView(FILES_VIEW_ID, files);
        }
        return viewId === DATABASES_VIEW_ID ? clientCellView(DATABASES_VIEW_ID, databases) : view;
    }, [viewId, view, files, databases]);
}
