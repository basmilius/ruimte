import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FILES_VIEW_ID, filesView, type CellView } from '@/shell/files-view';
import { useDocument } from '@/state/document';

/*
 * What stands in a cell, by the id the layout holds. Every surface that draws a cell asks this
 * instead of the document, because the files are the one thing in the grid the document has never
 * heard of.
 */
export const useCellView = (viewId: string | null): CellView | null => {
    const { t } = useTranslation('shell');
    const view = useDocument((state) => state.views.find((candidate) => candidate.id === viewId) ?? null);
    const name = t('filesView.name');
    return useMemo(() => (viewId === FILES_VIEW_ID ? filesView(name) : view), [viewId, view, name]);
};
