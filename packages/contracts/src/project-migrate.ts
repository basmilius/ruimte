import {
    MAIN_VIEW_ID,
    MAIN_VIEW_NAME,
    PROJECT_VERSION,
    ProjectDocumentV1Schema,
    ProjectDocumentV2Schema,
    ProjectLocalSchema,
    ProjectLocalV1Schema,
    ProjectSharedFileSchema,
    isCanvasView,
    type ProjectLocal,
    type ProjectSharedFile,
    type ProjectView
} from './project.ts';

/* What reading `.ruimte/project.json` gives: the file, and what an older one carried beside it. */
export interface SharedFileRead {
    file: ProjectSharedFile;
    /*
     * The rev of a version-1 or version-2 file, which moves into the private file, and the sign
     * that the folder still has to be split. Null for a file that is already version 3.
     */
    legacyRev: number | null;
}

/*
 * Reading a project file, on every version there has been. Version 1 was one canvas and version 2
 * put everything in one file; both become the shared file of version 3, and the daemon decides what
 * of it stays shared. A version-1 canvas keeps the fixed view id `main` on purpose: the file can be
 * committed, and two machines that migrate it on their own have to end up on the same id, or the
 * second save would add a ghost view next to the first one.
 */
export const migrateSharedFile = (value: unknown): SharedFileRead | null => {
    const current = ProjectSharedFileSchema.safeParse(value);
    if (current.success) {
        return { file: current.data, legacyRev: null };
    }
    const two = ProjectDocumentV2Schema.safeParse(value);
    if (two.success) {
        const { version: _version, rev, ...content } = two.data;
        return { file: { version: PROJECT_VERSION, ...content }, legacyRev: rev };
    }
    const one = ProjectDocumentV1Schema.safeParse(value);
    if (!one.success) {
        return null;
    }
    const { rev, name, color, icon, nodes, texts, edges, layouts } = one.data;
    return {
        file: {
            version: PROJECT_VERSION,
            name,
            color,
            ...(icon ? { icon } : {}),
            views: [{ kind: 'canvas', id: MAIN_VIEW_ID, name: MAIN_VIEW_NAME, nodes, texts, edges, layouts }]
        },
        legacyRev: rev
    };
};

/*
 * The version a file claims when this Ruimte is too old to know it. Such a file is not broken and
 * must never be set aside or written over: the release that understands it reads it back, and until
 * then it is someone's work. Null for anything this version can read, including a file with no
 * version at all, which the migrations answer for.
 */
export const newerVersionIn = (value: unknown, known: number): number | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    const version = (value as { version?: unknown }).version;
    return typeof version === 'number' && Number.isInteger(version) && version > known ? version : null;
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
    // Its camera is the screen-offset shape, which cannot be read without the viewport it was taken in.
    const { focusedNodeId, panels } = legacy.data;
    return {
        activeViewId: MAIN_VIEW_ID,
        views: { [MAIN_VIEW_ID]: { camera: null, focusedNodeId } },
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
