import { NODE_ACCENT_NAMES, type NodeAccent } from './node-defaults.ts';
import { isCanvasView, type ProjectFlags, type ProjectView } from './project.ts';

const KNOWN_FLAG_COLORS: ReadonlySet<string> = new Set(NODE_ACCENT_NAMES);

export const isFlagColor = (value: string): value is NodeAccent => KNOWN_FLAG_COLORS.has(value);

/* The flag on a view or a node as this version can paint it; a color it does not know reads as none. */
export const flagOf = (flags: ProjectFlags | undefined, id: string): NodeAccent | null => {
    const color = flags?.[id];
    return color !== undefined && isFlagColor(color) ? color : null;
};

/* The same map with these ids flagged in one color, or unflagged with null; null when nothing changes. */
export const withFlags = (flags: ProjectFlags | undefined, ids: readonly string[], color: NodeAccent | null): ProjectFlags | null => {
    const next: ProjectFlags = { ...flags };
    let changed = false;
    for (const id of ids) {
        if (color === null ? next[id] === undefined : next[id] === color) {
            continue;
        }
        if (color === null) {
            delete next[id];
        } else {
            next[id] = color;
        }
        changed = true;
    }
    return changed ? next : null;
};

/* Every id a flag can hang on: each view, and each node of a canvas. */
export const flaggableIds = (views: readonly ProjectView[]): Set<string> => {
    const ids = new Set<string>();
    for (const view of views) {
        ids.add(view.id);
        if (isCanvasView(view)) {
            for (const node of view.nodes) {
                ids.add(node.id);
            }
        }
    }
    return ids;
};

/* Only the flags whose view or node is still in the project, so one that was deleted takes its flag along. */
export const liveFlags = (flags: ProjectFlags | undefined, views: readonly ProjectView[]): ProjectFlags => {
    const ids = flaggableIds(views);
    return Object.fromEntries(Object.entries(flags ?? {}).filter(([id]) => ids.has(id)));
};
