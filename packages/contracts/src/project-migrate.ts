import {
    MAIN_VIEW_ID,
    MAIN_VIEW_NAME,
    ProjectDocumentSchema,
    ProjectDocumentV1Schema,
    ProjectLocalSchema,
    ProjectLocalV1Schema,
    isCanvasView,
    type ProjectDocument,
    type ProjectLocal,
    type ProjectView
} from './project.ts';

/*
 * Reading a project file. Version 2 is what the daemon writes; a version-1 file is wrapped in one
 * canvas view on the way in. The view keeps the fixed id `main` on purpose: the file can be
 * committed, and two machines that migrate it on their own have to end up on the same id, or the
 * second save would add a ghost view next to the first one.
 */
export const migrateDocument = (value: unknown): ProjectDocument | null => {
    const current = ProjectDocumentSchema.safeParse(value);
    if (current.success) {
        return current.data;
    }
    const legacy = ProjectDocumentV1Schema.safeParse(value);
    if (!legacy.success) {
        return null;
    }
    const { rev, name, color, icon, nodes, texts, edges, layouts } = legacy.data;
    return {
        version: 2,
        rev,
        name,
        color,
        ...(icon ? { icon } : {}),
        views: [{ kind: 'canvas', id: MAIN_VIEW_ID, name: MAIN_VIEW_NAME, nodes, texts, edges, layouts }]
    };
};

/* The machine-local file, on the same two versions. Anything unreadable starts from nothing. */
export const migrateLocal = (value: unknown): ProjectLocal => {
    const current = ProjectLocalSchema.safeParse(value);
    if (current.success) {
        return current.data;
    }
    const legacy = ProjectLocalV1Schema.safeParse(value);
    if (!legacy.success) {
        return EMPTY_LOCAL;
    }
    const { camera, focusedNodeId, panels } = legacy.data;
    return {
        activeViewId: MAIN_VIEW_ID,
        views: { [MAIN_VIEW_ID]: { camera, focusedNodeId } },
        ...(panels ? { panels } : {})
    };
};

export const EMPTY_LOCAL: ProjectLocal = { activeViewId: null, views: {} };

/*
 * The ids of every view and of every node on every canvas share one namespace, because together
 * they are the keys of the daemon's flat session map. A repeat means two things would attach to
 * one shell, so a file that has one is refused with a message that names the id.
 */
export const duplicateIdIn = (views: ProjectView[]): string | null => {
    const seen = new Set<string>();
    for (const view of views) {
        if (seen.has(view.id)) {
            return view.id;
        }
        seen.add(view.id);
        if (!isCanvasView(view)) {
            continue;
        }
        for (const node of view.nodes) {
            if (seen.has(node.id)) {
                return node.id;
            }
            seen.add(node.id);
        }
    }
    return null;
};

/*
 * An edge is a line on one canvas. A file that points one at something in another view (a bad
 * merge, a hand edit) loses that line rather than the view: nothing on screen could draw it.
 */
export const withoutCrossViewEdges = (views: ProjectView[]): ProjectView[] =>
    views.map((view) => {
        if (!isCanvasView(view)) {
            return view;
        }
        const here = new Set<string>([...view.nodes.map((node) => node.id), ...view.texts.map((text) => text.id)]);
        const edges = view.edges.filter((edge) => here.has(edge.from) && here.has(edge.to));
        return edges.length === view.edges.length ? view : { ...view, edges };
    });
