import type { ProjectLocal } from '@ruimte/contracts';
import { cleanLayout, focusedViewId, viewIdsIn } from '@/shell/split';

/*
 * What the project's local file may remember. A tab of this session only (a comparison, a snapshot) has no
 * content to restore, so the cell that holds it is left out and a reload finds a layout of cells that exist.
 * Ordinary loose tabs and every unknown key of the layout stay as they are.
 */
export function withoutSessionLayout(local: ProjectLocal, sessionIds: ReadonlySet<string>, projectViews: readonly string[]): ProjectLocal {
    const layout = local.layout;

    if (layout === undefined || !viewIdsIn(layout).some((id) => sessionIds.has(id))) {
        return local;
    }

    const cleaned = cleanLayout(
        layout,
        projectViews,
        viewIdsIn(layout).filter((id) => !sessionIds.has(id))
    );
    const { layout: _layout, emptyLayout: _emptyLayout, ...rest } = local;

    return {
        ...rest,
        activeViewId: cleaned === null ? null : focusedViewId(cleaned),
        ...(cleaned === null ? { emptyLayout: true } : { layout: { ...layout, ...cleaned } })
    };
}
