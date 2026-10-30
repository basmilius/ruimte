import type { ProjectLocal } from '@ruimte/contracts';
import { cleanLayout, focusedViewId, viewIdsIn } from '@/shell/split';

/* Runtime-only tabs must not leave dangling keys in the project-local layout. */
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
    const { layout: _layout, emptyLayout: _empty, ...rest } = local;
    return {
        ...rest,
        activeViewId: cleaned === null ? null : focusedViewId(cleaned),
        ...(cleaned === null ? { emptyLayout: true } : { layout: { ...layout, ...cleaned } })
    };
}
