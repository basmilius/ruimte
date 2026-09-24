import {
    isCanvasView,
    type ProjectCanvasView,
    type ProjectContent,
    type ProjectEdge,
    type ProjectFlags,
    type ProjectLayout,
    type ProjectNode,
    type ProjectText,
    type ProjectView
} from '@ruimte/contracts';

/*
 * What one canvas this client has to take in from the other side, in the shape the editor takes it
 * in. Everything in here is already on disk, so the editor applies it as a load and not as an edit.
 */
export interface CanvasPatch {
    /* Whole entries to put in by id: the ones that arrived, and the ones that took a field from the other side. */
    nodes: ProjectNode[];
    texts: ProjectText[];
    edges: ProjectEdge[];
    /* Ids the other side deleted while this client left them as they were. */
    removed: { nodes: string[]; texts: string[]; edges: string[] };
    /* The stacking order of the merged canvas, which is this client's unless only the other side moved it. */
    order: string[];
    /* The arrangements, when only the other side changed them; null keeps this client's. */
    layouts: ProjectLayout[] | null;
}

/* What the incoming document changes on this client, in the shape the stores take it in. */
export interface DocumentChanges {
    /* Whole views. Where they stand in the list is in the merged content, which is what gets loaded. */
    views: ProjectView[];
    /* Per view this client already has, what its canvas has to take in. Only views that take something. */
    canvases: Record<string, CanvasPatch>;
}

export type ProjectMerge = { ok: true; content: ProjectContent; changes: DocumentChanges } | { ok: false; reason: string };

type ViewMerge = { ok: true; view: ProjectView; patch: CanvasPatch | null } | { ok: false; reason: string };

type ElementsMerge<T> = { ok: true; elements: T[]; put: T[]; removed: string[] } | { ok: false; reason: string };

const refuse = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/*
 * Deep equality that reads a missing key and an undefined one as the same thing. What this client
 * holds went through the stores, what the daemon sent went through JSON, and only one of the two
 * can carry an `undefined`.
 */
const same = (a: unknown, b: unknown): boolean => {
    if (a === b) {
        return true;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => same(item, b[index]));
    }
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
        return false;
    }
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].every((key) => same(left[key], right[key]));
};

// Merge coupled values together so coordinates, title source and folded-group state cannot form hybrids.
type FieldGroups = Readonly<Record<string, readonly string[]>>;

const NODE_FIELDS: FieldGroups = {
    frame: ['x', 'y', 'w', 'h'],
    folding: ['collapsed', 'memberIds', 'expandedHeight'],
    title: ['title', 'titleSource']
};

const TEXT_FIELDS: FieldGroups = { position: ['x', 'y'] };

const EDGE_FIELDS: FieldGroups = { ends: ['from', 'to', 'fromSide', 'toSide'] };

type FieldsMerge<T> = { ok: true; merged: T; took: boolean } | { ok: false; field: string };

/*
 * The three-way rule for one entry both sides still have, per field. A side that left a field as
 * `base` had it takes the other side's. Only a field both sides changed to different values is a
 * conflict, unless `keepMine` says this client's value stands for it anyway.
 */
const mergeFields = <T extends object>(base: T, mine: T, theirs: T, groups: FieldGroups, keepMine: (field: string) => boolean): FieldsMerge<T> => {
    const was = base as Record<string, unknown>;
    const here = mine as Record<string, unknown>;
    const there = theirs as Record<string, unknown>;
    const grouped = new Map(Object.entries(groups).flatMap(([name, keys]) => keys.map((key) => [key, name] as const)));
    const visited = new Set<string>();
    let merged: Record<string, unknown> | null = null;
    for (const key of new Set([...Object.keys(was), ...Object.keys(here), ...Object.keys(there)])) {
        const name = grouped.get(key) ?? key;
        if (visited.has(name)) {
            continue;
        }
        visited.add(name);
        const keys = groups[name] ?? [key];
        const differs = (left: Record<string, unknown>, right: Record<string, unknown>): boolean => keys.some((field) => !same(left[field], right[field]));
        if (!differs(was, there) || !differs(here, there)) {
            continue;
        }
        if (differs(was, here)) {
            if (keepMine(name)) {
                continue;
            }
            return { ok: false, field: name };
        }
        merged ??= { ...here };
        for (const field of keys) {
            // A field the other side dropped is set to undefined rather than left out, so the editor's spread clears it too.
            merged[field] = there[field];
        }
    }
    return merged === null ? { ok: true, merged: mine, took: false } : { ok: true, merged: merged as T, took: true };
};

// Merge entries by id and field with maps because this runs over every canvas on each remote save.
const mergeElements = <T extends { id: string }>(
    kind: string,
    base: readonly T[],
    mine: readonly T[],
    theirs: readonly T[],
    groups: FieldGroups,
    keepMine: (id: string, field: string) => boolean = () => false
): ElementsMerge<T> => {
    const was = new Map(base.map((element) => [element.id, element]));
    const now = new Map(theirs.map((element) => [element.id, element]));
    const held = new Set(mine.map((element) => element.id));
    const elements: T[] = [];
    const put: T[] = [];
    const removed: string[] = [];
    for (const here of mine) {
        const before = was.get(here.id);
        const there = now.get(here.id);
        if (before === undefined || (there !== undefined && same(before, there))) {
            elements.push(here);
            continue;
        }
        if (there === undefined) {
            if (!same(before, here)) {
                return refuse(`the ${kind} ${here.id} was removed there and changed here`);
            }
            removed.push(here.id);
            continue;
        }
        const fields = mergeFields(before, here, there, groups, (field) => keepMine(here.id, field));
        if (!fields.ok) {
            return refuse(`the ${fields.field} of the ${kind} ${here.id} changed both here and there`);
        }
        elements.push(fields.merged);
        if (fields.took) {
            put.push(fields.merged);
        }
    }
    for (const there of theirs) {
        if (held.has(there.id)) {
            continue;
        }
        const before = was.get(there.id);
        if (before === undefined) {
            elements.push(there);
            put.push(there);
        } else if (!same(before, there)) {
            return refuse(`the ${kind} ${there.id} changed there and was removed here`);
        }
    }
    return { ok: true, elements, put, removed };
};

const sameOrder = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && left.every((id, index) => id === right[index]);

/*
 * The stacking order of the merged nodes. When only the other side moved the nodes both sides have
 * (a node brought to the front there), those take its order in the places they already hold here;
 * otherwise this client's order stands, both moving included. Stacking is the one field where both
 * sides changing it is no conflict. A click into a node brings it to the front, and a dialog for two
 * people clicking would be the dialog on every other save.
 */
const stackingOf = (base: readonly ProjectNode[], mine: readonly ProjectNode[], theirs: readonly ProjectNode[], merged: ProjectNode[]): ProjectNode[] => {
    const inBase = new Set(base.map((node) => node.id));
    const inMine = new Set(mine.map((node) => node.id));
    const inTheirs = new Set(theirs.map((node) => node.id));
    const shared = (node: ProjectNode): boolean => inBase.has(node.id) && inMine.has(node.id) && inTheirs.has(node.id);
    const baseOrder = base.filter(shared).map((node) => node.id);
    const theirOrder = theirs.filter(shared).map((node) => node.id);
    if (
        sameOrder(theirOrder, baseOrder) ||
        !sameOrder(
            mine.filter(shared).map((node) => node.id),
            baseOrder
        )
    ) {
        return merged;
    }
    const byId = new Map(merged.map((node) => [node.id, node]));
    let next = 0;
    return merged.map((node) => (shared(node) ? byId.get(theirOrder[next++]!)! : node));
};

const mergeCanvas = (base: ProjectCanvasView, mine: ProjectCanvasView, theirs: ProjectCanvasView, held: ReadonlySet<string>): ViewMerge => {
    let layouts: ProjectLayout[] | null = null;
    if (!same(base.layouts, theirs.layouts) && !same(mine.layouts, theirs.layouts)) {
        if (!same(base.layouts, mine.layouts)) {
            return refuse(`the arrangements of view ${base.id} changed both here and there`);
        }
        layouts = theirs.layouts;
    }

    /*
     * A node under the person's hand keeps the frame it has here, even where the other side moved it
     * too. A dialog in the middle of a drag is worse than either answer, and the save that follows the
     * drag is made against the rev taken in here, so the file ends where the person let go.
     */
    const nodes = mergeElements('node', base.nodes, mine.nodes, theirs.nodes, NODE_FIELDS, (id, field) => field === 'frame' && held.has(id));
    if (!nodes.ok) {
        return nodes;
    }
    const texts = mergeElements('text', base.texts, mine.texts, theirs.texts, TEXT_FIELDS);
    if (!texts.ok) {
        return texts;
    }
    const edges = mergeElements('edge', base.edges, mine.edges, theirs.edges, EDGE_FIELDS);
    if (!edges.ok) {
        return edges;
    }

    const stacked = stackingOf(base.nodes, mine.nodes, theirs.nodes, nodes.elements);
    const view: ProjectCanvasView = {
        ...mine,
        nodes: stacked,
        texts: texts.elements,
        edges: edges.elements,
        layouts: layouts ?? mine.layouts
    };
    /*
     * An edge needs both of its ends. One running to a node the other side deleted, or to one this
     * client deleted, would be written away by the next save, and silently dropping a line somebody
     * just drew is worse than asking.
     */
    const known = new Set([...view.nodes.map((node) => node.id), ...view.texts.map((text) => text.id)]);
    const dangling = view.edges.find((edge) => !known.has(edge.from) || !known.has(edge.to));
    if (dangling) {
        const end = known.has(dangling.from) ? dangling.to : dangling.from;
        return refuse(`the edge ${dangling.id} runs to ${end}, which this canvas does not have`);
    }

    const order = stacked.map((node) => node.id);
    const moved = !sameOrder(
        order,
        mine.nodes.map((node) => node.id)
    );
    const empty =
        nodes.put.length === 0 &&
        texts.put.length === 0 &&
        edges.put.length === 0 &&
        nodes.removed.length === 0 &&
        texts.removed.length === 0 &&
        edges.removed.length === 0 &&
        layouts === null &&
        !moved;
    const patch: CanvasPatch = {
        nodes: nodes.put,
        texts: texts.put,
        edges: edges.put,
        removed: { nodes: nodes.removed, texts: texts.removed, edges: edges.removed },
        order,
        layouts
    };
    return { ok: true, view, patch: empty ? null : patch };
};

/* What a view is called and what it wears, apart from what it holds. The name goes with its source, since a rename sets both. */
const VIEW_LABELS: readonly (readonly string[])[] = [['name', 'titleSource'], ['icon']];

const fieldsOf = (view: ProjectView, keys: readonly string[]): Record<string, unknown> =>
    Object.fromEntries(keys.map((key) => [key, (view as Record<string, unknown>)[key]]));

const withoutLabels = (view: ProjectView): Record<string, unknown> => {
    const { name: _name, titleSource: _titleSource, icon: _icon, ...rest } = view as Record<string, unknown>;
    return rest;
};

/*
 * Three-way per label. A side that left the name or the icon alone takes the other side's, so a
 * rename in another client lands beside an edit here. Only the same label changed differently on
 * both sides is a conflict.
 */
const mergeLabels = (base: ProjectView, mine: ProjectView, theirs: ProjectView, merged: ProjectView): ViewMerge => {
    let view = merged as Record<string, unknown>;
    for (const keys of VIEW_LABELS) {
        const was = fieldsOf(base, keys);
        const here = fieldsOf(mine, keys);
        const there = fieldsOf(theirs, keys);
        if (same(was, there) || same(here, there)) {
            continue;
        }
        if (!same(was, here)) {
            return keys[0] === 'name'
                ? refuse(`the view ${base.id} was renamed to "${String(there.name)}" there and to "${String(here.name)}" here`)
                : refuse(`the icon of the view ${base.id} changed both here and there`);
        }
        // A label theirs dropped goes as a missing key, the shape the stores and the file both use.
        view = Object.fromEntries(Object.entries({ ...view, ...there }).filter(([key, value]) => !keys.includes(key) || value !== undefined));
    }
    return { ok: true, view: view as ProjectView, patch: null };
};

const mergeView = (base: ProjectView, mine: ProjectView, theirs: ProjectView, held: ReadonlySet<string>): ViewMerge => {
    if (base.kind !== theirs.kind) {
        return refuse(`the view ${base.id} became a ${theirs.kind}`);
    }
    if (!isCanvasView(base) || !isCanvasView(theirs) || !isCanvasView(mine)) {
        // Everything but a canvas holds one thing, so there is nothing in it that could be added to.
        return same(withoutLabels(base), withoutLabels(theirs)) ? mergeLabels(base, mine, theirs, mine) : refuse(`the view ${base.id} changed`);
    }
    const canvas = mergeCanvas(base, mine, theirs, held);
    if (!canvas.ok) {
        return canvas;
    }
    const labels = mergeLabels(base, mine, theirs, canvas.view);
    return labels.ok ? { ...canvas, view: labels.view } : labels;
};

const idsOf = (views: readonly ProjectView[], within: ReadonlySet<string>): string[] => views.map((view) => view.id).filter((id) => within.has(id));

/*
 * `primary` in its own order, with every id of `secondary` that is missing from it put right after
 * the nearest id before it in `secondary` that already stands, or first when there is none. Only
 * ids in `present` take part. A view deleted on one side has no place to keep.
 */
const interleave = (primary: readonly string[], secondary: readonly string[], present: ReadonlySet<string>): string[] => {
    const order = primary.filter((id) => present.has(id));
    secondary.forEach((id, index) => {
        if (!present.has(id) || order.includes(id)) {
            return;
        }
        const before = secondary
            .slice(0, index)
            .reverse()
            .find((candidate) => order.includes(candidate));
        order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, id);
    });
    return order;
};

/*
 * Three-way per id, the rule a field of a node follows. When both sides flagged one id differently
 * this client's flag stands rather than refusing the whole document: a flag is a mark, not work.
 */
const mergeFlags = (base: ProjectFlags = {}, mine: ProjectFlags = {}, theirs: ProjectFlags = {}): ProjectFlags => {
    const merged: ProjectFlags = { ...mine };
    for (const id of new Set([...Object.keys(base), ...Object.keys(theirs)])) {
        if (base[id] === theirs[id] || mine[id] !== base[id]) {
            continue;
        }
        if (theirs[id] === undefined) {
            delete merged[id];
        } else {
            merged[id] = theirs[id];
        }
    }
    return merged;
};

/*
 * Three-way merge by id and field. Local edits win unless both sides changed the same field,
 * deleted a changed entry or orphaned an edge. Nodes in `handled` keep their local frame.
 */
export const mergeProject = (base: ProjectContent, mine: ProjectContent, theirs: ProjectContent, handled: ReadonlySet<string> = new Set()): ProjectMerge => {
    if (base.name !== theirs.name) {
        return refuse(`the project was renamed to "${theirs.name}"`);
    }
    if (base.color !== theirs.color) {
        return refuse('the color of the project changed');
    }
    if (!same(base.icon, theirs.icon)) {
        return refuse('the icon of the project changed');
    }

    const known = new Map(base.views.map((view) => [view.id, view]));
    const lost = base.views.find((view) => !theirs.views.some((candidate) => candidate.id === view.id));
    if (lost) {
        return refuse(`the view ${lost.id} was removed`);
    }

    const held = new Map(mine.views.map((view) => [view.id, view]));
    const merged = new Map<string, ProjectView>();
    const added: ProjectView[] = [];
    const canvases: Record<string, CanvasPatch> = {};
    for (const view of theirs.views) {
        const before = known.get(view.id);
        const standing = held.get(view.id);
        if (!before) {
            if (standing) {
                return refuse(`the view ${view.id} arrived, and this client already has one with that id`);
            }
            added.push(view);
            continue;
        }
        if (!standing) {
            // Deleted here and untouched there. This client's deletion stands, and takes it with it.
            if (!same(before, view)) {
                return refuse(`the view ${view.id} changed after this client removed it`);
            }
            continue;
        }
        const outcome = mergeView(before, standing, view, handled);
        if (!outcome.ok) {
            return outcome;
        }
        merged.set(view.id, outcome.view);
        if (outcome.patch) {
            canvases[view.id] = outcome.patch;
        }
    }

    /*
     * The order is three-way over the views both sides still have. A side that kept the order of
     * `base` takes the other side's; both moving them is a conflict unless they agree. The views only
     * one side has go beside the view they followed on that side.
     */
    const shared = new Set(base.views.map((view) => view.id).filter((id) => held.has(id)));
    const baseOrder = idsOf(base.views, shared);
    const mineOrder = idsOf(mine.views, shared);
    const theirOrder = idsOf(theirs.views, shared);
    const movedHere = !sameOrder(mineOrder, baseOrder);
    const movedThere = !sameOrder(theirOrder, baseOrder);
    if (movedHere && movedThere && !sameOrder(mineOrder, theirOrder)) {
        return refuse('the views were put in another order both here and there');
    }
    const fresh = new Map(added.map((view) => [view.id, view]));
    const present = new Set([...mine.views.map((view) => view.id), ...fresh.keys()]);
    const mineIds = mine.views.map((view) => view.id);
    const theirIds = theirs.views.map((view) => view.id);
    const order = movedThere && !movedHere ? interleave(theirIds, mineIds, present) : interleave(mineIds, theirIds, present);
    const views = order.map((id) => merged.get(id) ?? fresh.get(id) ?? held.get(id)!);

    return {
        ok: true,
        content: {
            name: mine.name,
            color: mine.color,
            ...(mine.icon ? { icon: mine.icon } : {}),
            views,
            flags: mergeFlags(base.flags, mine.flags, theirs.flags)
        },
        changes: { views: added, canvases }
    };
};
