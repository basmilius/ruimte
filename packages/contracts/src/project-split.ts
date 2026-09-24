import { liveFlags } from './project-flags.ts';
import { isAbsolutePath } from './stored-path.ts';
import {
    EMPTY_PRIVATE_FILE,
    PROJECT_PRIVATE_VERSION,
    PROJECT_VERSION,
    isCanvasView,
    isDividerView,
    type ProjectContent,
    type ProjectNode,
    type ProjectNodeOverlay,
    type ProjectPrivateFile,
    type ProjectSharedFile,
    type ProjectView
} from './project.ts';

/*
 * A project lives in two files. `.ruimte/project.json` is the one a team commits: the identity of
 * the project and the views a person put in git. `.ruimte/private/project.json` holds the rest and
 * never leaves the machine. What decides is one list of view ids; everything here follows from it.
 *
 * A view goes in whole. Sharing half a canvas would give a colleague lines to nodes that are not
 * there, so the only thing that travels per field is what a shared node cannot carry: the session
 * you are resuming, the mode it runs in, the worktree it sits in and any path off your own disk.
 * Those wait in the overlay of the private file and are laid back over the node on the way in.
 */

/* The fields of a node that belong to one person, whatever canvas the node is on. */
const OVERLAY_FIELDS = ['resume', 'runtimeMode', 'worktree'] as const;

/* And the ones that belong to one machine only when they name a place outside the project folder. */
const PATH_FIELDS = ['cwd', 'path'] as const;

type Carrier = { [K in keyof ProjectNodeOverlay]?: ProjectNodeOverlay[K] };

/* What a carrier cannot take into the shared file, or null when it can travel as it is. */
const overlayOfCarrier = (carrier: Carrier): ProjectNodeOverlay | null => {
    const overlay: ProjectNodeOverlay = {};
    for (const field of OVERLAY_FIELDS) {
        if (carrier[field] !== undefined) {
            overlay[field] = carrier[field] as never;
        }
    }
    for (const field of PATH_FIELDS) {
        const value = carrier[field];
        if (typeof value === 'string' && isAbsolutePath(value)) {
            overlay[field] = value;
        }
    }
    return Object.keys(overlay).length === 0 ? null : overlay;
};

const withoutOverlay = <T extends Carrier>(carrier: T, overlay: ProjectNodeOverlay): T => {
    const stripped = { ...carrier };
    for (const field of Object.keys(overlay) as (keyof ProjectNodeOverlay)[]) {
        delete stripped[field];
    }
    return stripped;
};

/*
 * Why this view cannot go in the shared file, or null when it can. A file view is its path, so one
 * that points off the project folder has nothing left to share; every other kind keeps working
 * without the fields that stay behind.
 */
export const viewShareRefusal = (view: ProjectView): 'path-outside-project' | 'follows-its-group' | null => {
    if (isDividerView(view)) {
        return 'follows-its-group';
    }
    return view.kind === 'file' && isAbsolutePath(view.path) ? 'path-outside-project' : null;
};

export const canShareView = (view: ProjectView): boolean => viewShareRefusal(view) === null;

/*
 * The asked-for ids that name a view of this project that may travel, and the dividers that go with
 * them. Nobody shares a divider: a line and a heading mark the list rather than standing in it, so
 * one travels when a view in the stretch under it does and stays home when that whole stretch is
 * one person's. Any other rule leaves a colleague with two lines on top of each other, or with a
 * heading over nothing. The last of each kind is the one that goes, which is why a line and the
 * heading under it both reach the shared file while two lines in a row do not.
 */
const sharedIdsOf = (views: readonly ProjectView[], shared: readonly string[]): Set<string> => {
    const asked = new Set(shared);
    const ids = new Set(views.filter((view) => asked.has(view.id) && canShareView(view)).map((view) => view.id));
    const above = new Map<string, string>();
    for (const view of views) {
        if (isDividerView(view)) {
            above.set(view.kind, view.id);
        } else if (ids.has(view.id) && above.size > 0) {
            for (const id of above.values()) {
                ids.add(id);
            }
            above.clear();
        }
    }
    return ids;
};

/*
 * Every node of a view, by the id its overlay hangs on. A canvas has one per node; a chat and a
 * terminal are one session under the view's own id, and nothing else carries anything at all.
 */
const withCarriers = (view: ProjectView, map: (id: string, carrier: Carrier) => Carrier): ProjectView => {
    if (isCanvasView(view)) {
        return { ...view, nodes: view.nodes.map((node: ProjectNode) => map(node.id, node) as ProjectNode) };
    }
    return view.kind === 'chat' || view.kind === 'terminal' ? { ...view, node: map(view.id, view.node) as typeof view.node } : view;
};

/* What the two files hold, worked out from one document. */
export interface ProjectSplit {
    shared: ProjectSharedFile;
    private: ProjectPrivateFile;
}

export const splitContent = (content: ProjectContent, shared: readonly string[], rev: number): ProjectSplit => {
    const ids = sharedIdsOf(content.views, shared);
    const overlay: Record<string, ProjectNodeOverlay> = {};
    const travelling: ProjectView[] = [];
    const rest: ProjectView[] = [];
    for (const view of content.views) {
        if (!ids.has(view.id)) {
            rest.push(view);
            continue;
        }
        travelling.push(
            withCarriers(view, (id, carrier) => {
                const held = overlayOfCarrier(carrier);
                if (!held) {
                    return carrier;
                }
                overlay[id] = held;
                return withoutOverlay(carrier, held);
            })
        );
    }
    // A flag is one person's mark, so it stays here whichever file its view went to.
    const flags = liveFlags(content.flags, content.views);
    return {
        shared: {
            version: PROJECT_VERSION,
            name: content.name,
            color: content.color,
            ...(content.icon ? { icon: content.icon } : {}),
            views: travelling
        },
        private: {
            version: PROJECT_PRIVATE_VERSION,
            rev,
            views: rest,
            order: content.views.map((view) => view.id),
            overlay,
            ...(Object.keys(flags).length > 0 ? { flags } : {})
        }
    };
};

/*
 * The sidebar order over both files. The private file names every row it knew; a shared id it does
 * not know falls in behind the one before it in the shared file, which is where a colleague put it.
 */
const orderedViews = (shared: ProjectView[], rest: ProjectView[], order: readonly string[]): ProjectView[] => {
    const byId = new Map<string, ProjectView>();
    for (const view of [...shared, ...rest]) {
        byId.set(view.id, view);
    }
    const placed = new Set<string>();
    const views: ProjectView[] = [];
    const take = (id: string): void => {
        const view = byId.get(id);
        if (view && !placed.has(id)) {
            placed.add(id);
            views.push(view);
        }
    };
    for (const id of order) {
        take(id);
    }
    // Whatever the order never named, in the order of the file it came out of.
    let after = views.length;
    for (const [index, view] of shared.entries()) {
        if (placed.has(view.id)) {
            after = views.indexOf(view) + 1;
            continue;
        }
        const previous = shared[index - 1];
        const at = previous && placed.has(previous.id) ? views.indexOf(previous) + 1 : after;
        placed.add(view.id);
        views.splice(at, 0, view);
        after = at + 1;
    }
    for (const view of rest) {
        take(view.id);
    }
    return views;
};

/* One document out of the two files, with every overlay laid back over the node it belongs to. */
export const mergeFiles = (
    shared: ProjectSharedFile | null,
    file: ProjectPrivateFile,
    fallback: { name: string; color: string }
): { content: ProjectContent; shared: string[] } => {
    const overlay = file.overlay;
    const sharedViews = (shared?.views ?? []).map((view) =>
        withCarriers(view, (id, carrier) => {
            const held = overlay[id];
            return held ? { ...carrier, ...held } : carrier;
        })
    );
    return {
        content: {
            name: shared?.name ?? fallback.name,
            color: shared?.color ?? fallback.color,
            ...(shared?.icon ? { icon: shared.icon } : {}),
            views: orderedViews(sharedViews, file.views, file.order),
            ...(file.flags ? { flags: file.flags } : {})
        },
        shared: sharedViews.map((view) => view.id)
    };
};

/* A project that has never been split: every view of it is one person's until they say otherwise. */
export const privateFileOf = (views: readonly ProjectView[], rev: number): ProjectPrivateFile => ({
    ...EMPTY_PRIVATE_FILE,
    rev,
    views: [...views],
    order: views.map((view) => view.id)
});
