import { LooseGlyph } from '@/files/LooseGlyph';
import { ViewGlyph } from '@/project/ViewGlyph';
import { useDocument } from '@/state/document';
import { viewGlyphOf } from '@/surface/cell-view';
import { looseTabLabel } from '@/surface/panels/tab-label';
import { usePendingViews } from './pending-views';

/*
 * What an auxiliary window draws while it has no view: during the drag that opened it, the view that
 * is on its way. The view itself stays in the window it is dragged out of until the drag ends.
 */
export function AuxPending() {
    const [first] = usePendingViews((s) => s.items);
    const view = useDocument((s) => (first?.kind === 'view' ? (s.views.find((candidate) => candidate.id === first.id) ?? null) : null));
    const name = first?.kind === 'loose' ? looseTabLabel(first.tab) : (view?.name ?? null);

    return (
        <div className="absolute inset-0 grid place-items-center bg-surface">
            {name !== null && (
                <div className="flex max-w-full items-center gap-2 px-6 text-sm text-text-muted">
                    {first?.kind === 'loose' ? <LooseGlyph tab={first.tab} size={16} /> : view !== null && <ViewGlyph {...viewGlyphOf(view)} size={16} />}
                    <span className="truncate">{name}</span>
                </div>
            )}
        </div>
    );
}
