import { DEFAULT_TITLES } from './node-defaults.ts';
import { liveFlags } from './project-flags.ts';
import { isAbsolutePath } from './stored-path.ts';
import {
    EMPTY_PRIVATE_FILE,
    PROJECT_PRIVATE_VERSION,
    PROJECT_VERSION,
    isCanvasView,
    isDividerView,
    type NodeKind,
    type ProjectContent,
    type ProjectNode,
    type ProjectNodeOverlay,
    type ProjectPrivateFile,
    type ProjectSql,
    type ProjectSharedFile,
    type ProjectView
} from './project.ts';

/*
 * One list of view ids decides which views go in the shared file, and a view goes in whole: half a
 * canvas would give a colleague lines to nodes that are not there. What a shared node cannot carry
 * waits in the private file's overlay and is laid back over the node on the way in.
 */

// One person's, whatever canvas the node is on. An account id names a config folder on this machine.
const OVERLAY_FIELDS = ['resume', 'account', 'runtimeMode', 'worktree'] as const;

// One machine's only when they name a place outside the project folder.
const PATH_FIELDS = ['cwd', 'path'] as const;

type CarrierOverlay = Omit<ProjectNodeOverlay, 'title' | 'name'>;

type Carrier = { [K in keyof CarrierOverlay]?: CarrierOverlay[K] };

// Either separator, so it holds on both kinds of machine.
function climbsOut(path: string): boolean {
    let depth = 0;
    for (const segment of path.split(/[\\/]/)) {
        if (segment === '..') {
            depth -= 1;
            if (depth < 0) {
                return true;
            }
        } else if (segment !== '' && segment !== '.') {
            depth += 1;
        }
    }
    return false;
}

function isPortablePath(path: string): boolean {
    return !isAbsolutePath(path) && !climbsOut(path);
}

function overlayOfCarrier(carrier: Carrier): CarrierOverlay | null {
    const overlay: CarrierOverlay = {};
    for (const field of OVERLAY_FIELDS) {
        if (carrier[field] !== undefined) {
            overlay[field] = carrier[field] as never;
        }
    }
    for (const field of PATH_FIELDS) {
        const value = carrier[field];
        if (typeof value === 'string' && !isPortablePath(value)) {
            overlay[field] = value;
        }
    }
    return Object.keys(overlay).length === 0 ? null : overlay;
}

/*
 * Anyone who can push can write the shared file, so a mode, session, worktree or folder off this disk
 * found there is not this person's and must not start anything: drop all `splitContent` never writes.
 */
function trustedOfShared<T extends Carrier>(carrier: T): T {
    const trusted = { ...carrier };
    for (const field of OVERLAY_FIELDS) {
        delete trusted[field];
    }
    for (const field of PATH_FIELDS) {
        const value = trusted[field];
        if (typeof value === 'string' && !isPortablePath(value)) {
            delete trusted[field];
        }
    }
    return trusted;
}

function withoutOverlay<T extends Carrier>(carrier: T, overlay: CarrierOverlay): T {
    const stripped = { ...carrier };
    for (const field of Object.keys(overlay) as (keyof CarrierOverlay)[]) {
        delete stripped[field];
    }
    return stripped;
}

function carrierPartOf(overlay: ProjectNodeOverlay | undefined): CarrierOverlay | null {
    if (!overlay) {
        return null;
    }
    const part: ProjectNodeOverlay = { ...overlay };
    delete part.title;
    delete part.name;
    return Object.keys(part).length === 0 ? null : part;
}

function defaultTitleOf(kind: string): string | null {
    return Object.hasOwn(DEFAULT_TITLES, kind) ? DEFAULT_TITLES[kind as NodeKind] : null;
}

/*
 * Moves every name a session gave into the overlay, so an agent naming its chat never shows up in git.
 * Without a `titleSource` a colleague's own session names the node again; a typed name travels.
 */
function withoutSessionTitles(view: ProjectView, overlay: Record<string, ProjectNodeOverlay>): ProjectView {
    const hold = (id: string, entry: ProjectNodeOverlay): void => {
        overlay[id] = { ...overlay[id], ...entry };
    };
    let next = view;
    if (isCanvasView(view)) {
        next = {
            ...view,
            nodes: view.nodes.map((node: ProjectNode) => {
                const title = defaultTitleOf(node.kind);
                if (node.titleSource !== 'auto' || title === null) {
                    return node;
                }
                hold(node.id, { title: node.title });
                const stripped = { ...node, title };
                delete stripped.titleSource;
                return stripped;
            })
        };
    }
    const name = defaultTitleOf(next.kind);
    if (!('titleSource' in next) || next.titleSource !== 'auto' || name === null) {
        return next;
    }
    hold(next.id, { name: next.name });
    const stripped = { ...next, name };
    delete stripped.titleSource;
    return stripped;
}

function withSessionTitles(view: ProjectView, overlay: Record<string, ProjectNodeOverlay>): ProjectView {
    let next = view;
    if (isCanvasView(view)) {
        next = {
            ...view,
            nodes: view.nodes.map((node: ProjectNode) => {
                const title = overlay[node.id]?.title;
                return title === undefined || node.titleSource === 'user' ? node : { ...node, title, titleSource: 'auto' as const };
            })
        };
    }
    const name = overlay[next.id]?.name;
    if (name === undefined || ('titleSource' in next && next.titleSource === 'user')) {
        return next;
    }
    return { ...next, name, titleSource: 'auto' } as ProjectView;
}

// A file view is its path, so one off the project folder has nothing left to share.
export function viewShareRefusal(view: ProjectView): 'path-outside-project' | 'follows-its-group' | null {
    if (isDividerView(view)) {
        return 'follows-its-group';
    }
    return view.kind === 'file' && !isPortablePath(view.path) ? 'path-outside-project' : null;
}

export function canShareView(view: ProjectView): boolean {
    return viewShareRefusal(view) === null;
}

/*
 * A divider travels when a view in the stretch under it does, so a colleague never gets two lines on
 * top of each other or a heading over nothing. Only the last of each kind goes: a line and the heading
 * under it both travel, two lines in a row do not.
 */
function sharedIdsOf(views: readonly ProjectView[], shared: readonly string[]): Set<string> {
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
}

// A chat and a terminal view are one session under the view's own id; other kinds carry nothing.
function withCarriers(view: ProjectView, map: (id: string, carrier: Carrier) => Carrier): ProjectView {
    if (isCanvasView(view)) {
        return { ...view, nodes: view.nodes.map((node: ProjectNode) => map(node.id, node) as ProjectNode) };
    }
    return view.kind === 'chat' || view.kind === 'terminal' ? { ...view, node: map(view.id, view.node) as typeof view.node } : view;
}

function isEmptySql(sql: ProjectSql): boolean {
    return sql.default === undefined && Object.keys(sql.files ?? {}).length === 0;
}

export interface ProjectSplit {
    shared: ProjectSharedFile;
    private: ProjectPrivateFile;
}

export function splitContent(content: ProjectContent, shared: readonly string[], rev: number): ProjectSplit {
    const ids = sharedIdsOf(content.views, shared);
    const overlay: Record<string, ProjectNodeOverlay> = {};
    const travelling: ProjectView[] = [];
    const rest: ProjectView[] = [];
    for (const view of content.views) {
        if (!ids.has(view.id)) {
            rest.push(view);
            continue;
        }
        const carried = withCarriers(view, (id, carrier) => {
            const held = overlayOfCarrier(carrier);
            if (!held) {
                return carrier;
            }
            overlay[id] = held;
            return withoutOverlay(carrier, held);
        });
        travelling.push(withoutSessionTitles(carried, overlay));
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
            ...(Object.keys(flags).length > 0 ? { flags } : {}),
            ...(content.sql && !isEmptySql(content.sql) ? { sql: content.sql } : {})
        }
    };
}

// A shared id the private order does not know falls in behind the one before it in the shared file.
function orderedViews(shared: ProjectView[], rest: ProjectView[], order: readonly string[]): ProjectView[] {
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
}

export function mergeFiles(
    shared: ProjectSharedFile | null,
    file: ProjectPrivateFile,
    fallback: { name: string; color: string }
): { content: ProjectContent; shared: string[] } {
    const overlay = file.overlay;
    // Ruimte never writes a file view off the folder there, so one that is came from whoever pushed it.
    const sharedViews = (shared?.views ?? [])
        .filter((view) => viewShareRefusal(view) !== 'path-outside-project')
        .map((view) =>
            withSessionTitles(
                withCarriers(view, (id, carrier) => {
                    const trusted = trustedOfShared(carrier);
                    const held = carrierPartOf(overlay[id]);
                    return held ? { ...trusted, ...held } : trusted;
                }),
                overlay
            )
        );
    return {
        content: {
            name: shared?.name ?? fallback.name,
            color: shared?.color ?? fallback.color,
            ...(shared?.icon ? { icon: shared.icon } : {}),
            views: orderedViews(sharedViews, file.views, file.order),
            ...(file.flags ? { flags: file.flags } : {}),
            ...(file.sql ? { sql: file.sql } : {})
        },
        shared: sharedViews.map((view) => view.id)
    };
}

// Taken out of a version 1 or 2 file before `mergeFiles` strips it: Ruimte wrote that file, nobody pulled it.
export function overlayOfLegacy(views: readonly ProjectView[]): Record<string, ProjectNodeOverlay> {
    const overlay: Record<string, ProjectNodeOverlay> = {};
    for (const view of views) {
        withCarriers(view, (id, carrier) => {
            const held = overlayOfCarrier(carrier);
            if (held) {
                overlay[id] = held;
            }
            return carrier;
        });
    }
    return overlay;
}

export function privateFileOf(views: readonly ProjectView[], rev: number): ProjectPrivateFile {
    return {
        ...EMPTY_PRIVATE_FILE,
        rev,
        views: [...views],
        order: views.map((view) => view.id)
    };
}
