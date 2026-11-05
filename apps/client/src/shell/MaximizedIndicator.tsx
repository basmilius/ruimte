import { Button, Kbd, Tooltip } from '@adecore/ui';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { cellCount, cellViewIds, isSameCell, type CellAt } from '@/layout/split';
import { useDocument } from '@/state/document';
import { CANVAS_SHORTCUTS } from '@/surface/canvas/shortcuts';

/*
 * What stands in for the cells a maximized one hides: their shape, how many there are, and the way back.
 * It sits in the cell's bar, since anywhere over the body it covers the last lines of what the view draws.
 */
export function MaximizedIndicator({ at }: { at: CellAt }) {
    const { t } = useTranslation('shell');
    const layout = useDocument((s) => s.layout);
    if (layout === null) {
        return null;
    }
    return (
        <Tooltip label={t('cellToolbar.restore')} name>
            <Button size="sm" data-maximized-indicator="" className="shrink-0 cursor-default" onClick={() => useDocument.getState().toggleMaximized()}>
                {/* Whole pixels for one, two or three of either, with a pixel between them. */}
                <span aria-hidden className="flex h-2.75 w-4.25 gap-px">
                    {layout.columns.map((column, columnIndex) => (
                        <span key={cellViewIds(column.cells[0]!)[0]} className="flex flex-1 flex-col gap-px">
                            {column.cells.map((cell, cellIndex) => (
                                <span
                                    key={cellViewIds(cell)[0]}
                                    className={clsx(
                                        'flex-1 rounded-xs',
                                        isSameCell(at, { column: columnIndex, cell: cellIndex }) ? 'bg-text-muted' : 'bg-border-strong'
                                    )}
                                />
                            ))}
                        </span>
                    ))}
                </span>
                {t('cellToolbar.hidden', { count: cellCount(layout) - 1 })}
                <span aria-hidden>·</span>
                <Kbd shortcut={CANVAS_SHORTCUTS.maximizeCell} className="font-sans" />
            </Button>
        </Tooltip>
    );
}
