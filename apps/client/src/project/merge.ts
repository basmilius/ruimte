import {
    isCanvasView,
    type ProjectCanvasView,
    type ProjectContent,
    type ProjectEdge,
    type ProjectNode,
    type ProjectText,
    type ProjectView
} from '@ruimte/contracts';

/* What one canvas this client already has gained. Everything in here is new to it, by id. */
export interface CanvasAddition {
    nodes: ProjectNode[];
    texts: ProjectText[];
    edges: ProjectEdge[];
    /* Ids to append to the members of a group this client already has, by group id. */
    members: Record<string, string[]>;
}

/* Everything the incoming document has that this client does not, in the shape the stores take it in. */
export interface DocumentAdditions {
    /* Whole views. Where they stand in the list is in the merged content, which is what gets loaded. */
    views: ProjectView[];
    /* Per view this client already has, what that canvas gained. Only views that gained something. */
    canvases: Record<string, CanvasAddition>;
}

export type ProjectMerge = { ok: true; content: ProjectContent; additions: DocumentAdditions } | { ok: false; reason: string };

type ViewMerge = { ok: true; view: ProjectView; addition: CanvasAddition | null } | { ok: false; reason: string };

type ElementMerge<T> = { ok: true; added: T[] } | { ok: false; reason: string };

const refuse = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/*
 * Deep equality that reads a missing key and an undefined one as the same thing: what this client
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

const differingKeys = (a: object, b: object): string[] => {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((key) => !same(left[key], right[key]));
};

/*
 * The three-way rule for one kind of element, by id: what `theirs` gained comes over, what it
 * changed or lost is a conflict. An element this client already has under an id the daemon does not
 * know yet is one it just made and has not written out, so it is left where it is.
 *
 * `accept` gets the last word on an element that is not equal, which is how a group that only
 * gained members still passes as an addition.
 */
const mergeElements = <T extends { id: string }>(
    kind: string,
    base: readonly T[],
    mine: readonly T[],
    theirs: readonly T[],
    options: { ordered?: boolean; accept?: (was: T, now: T) => boolean } = {}
): ElementMerge<T> => {
    const was = new Map(base.map((element) => [element.id, element]));
    const held = new Set(mine.map((element) => element.id));
    const added: T[] = [];
    for (const element of theirs) {
        const before = was.get(element.id);
        if (before === undefined) {
            if (!held.has(element.id)) {
                added.push(element);
            }
            continue;
        }
        if (!same(before, element) && !(options.accept?.(before, element) ?? false)) {
            return refuse(`the ${kind} ${element.id} changed`);
        }
    }
    const now = new Set(theirs.map((element) => element.id));
    const gone = base.find((element) => !now.has(element.id));
    if (gone) {
        return refuse(`the ${kind} ${gone.id} was removed`);
    }
    if (options.ordered) {
        const order = theirs.filter((element) => was.has(element.id));
        if (order.some((element, index) => element.id !== base[index]!.id)) {
            return refuse(`the ${kind}s of this canvas were put in another order`);
        }
    }
    return { ok: true, added };
};

/* Whatever a group gained, appended to the members this client holds for it. */
const withMembers = (node: ProjectNode, grown: Record<string, string[]>): ProjectNode => {
    const extra = grown[node.id];
    if (!extra) {
        return node;
    }
    const members = node.memberIds ?? [];
    return { ...node, memberIds: [...members, ...extra.filter((id) => !members.includes(id))] };
};

const mergeCanvas = (base: ProjectCanvasView, mine: ProjectCanvasView, theirs: ProjectCanvasView): ViewMerge => {
    if (!same(base.layouts, theirs.layouts)) {
        return refuse(`the arrangements of view ${base.id} changed`);
    }

    /*
     * A group that only gained members is an addition like any other: while a group is open its
     * membership is read off the positions, so the file only spells it out for a collapsed one, and
     * there the node the agent just made would be invisible without this. Anything else about a node
     * this client already has is a change, and a change is for the person to settle.
     */
    const arriving = new Set(theirs.nodes.filter((node) => !base.nodes.some((candidate) => candidate.id === node.id)).map((node) => node.id));
    const grown: Record<string, string[]> = {};
    const acceptGrowth = (was: ProjectNode, now: ProjectNode): boolean => {
        const keys = differingKeys(was, now);
        if (keys.length !== 1 || keys[0] !== 'memberIds') {
            return false;
        }
        const before = was.memberIds ?? [];
        const after = now.memberIds ?? [];
        const extra = after.filter((id) => !before.includes(id));
        if (after.length !== before.length + extra.length || !before.every((id) => after.includes(id)) || !extra.every((id) => arriving.has(id))) {
            return false;
        }
        grown[now.id] = extra;
        return true;
    };

    const nodes = mergeElements('node', base.nodes, mine.nodes, theirs.nodes, { ordered: true, accept: acceptGrowth });
    if (!nodes.ok) {
        return nodes;
    }
    const texts = mergeElements('text', base.texts, mine.texts, theirs.texts);
    if (!texts.ok) {
        return texts;
    }
    const edges = mergeElements('edge', base.edges, mine.edges, theirs.edges);
    if (!edges.ok) {
        return edges;
    }

    const view: ProjectCanvasView = {
        ...mine,
        nodes: [...mine.nodes.map((node) => withMembers(node, grown)), ...nodes.added],
        texts: [...mine.texts, ...texts.added],
        edges: [...mine.edges, ...edges.added]
    };
    /*
     * An edge is only additive when it has both ends. One that runs to a node this client deleted
     * would be written away by the next save, and silently dropping a line an agent just drew is
     * worse than asking.
     */
    const known = new Set([...view.nodes.map((node) => node.id), ...view.texts.map((text) => text.id)]);
    const dangling = edges.added.find((edge) => !known.has(edge.from) || !known.has(edge.to));
    if (dangling) {
        const end = known.has(dangling.from) ? dangling.to : dangling.from;
        return refuse(`the edge ${dangling.id} runs to ${end}, which this canvas does not have`);
    }

    const addition: CanvasAddition = { nodes: nodes.added, texts: texts.added, edges: edges.added, members: grown };
    const empty = addition.nodes.length === 0 && addition.texts.length === 0 && addition.edges.length === 0 && Object.keys(grown).length === 0;
    return { ok: true, view, addition: empty ? null : addition };
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
 * Three-way per label: a side that left the name or the icon alone takes the other side's, so a
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
    return { ok: true, view: view as ProjectView, addition: null };
};

const mergeView = (base: ProjectView, mine: ProjectView, theirs: ProjectView): ViewMerge => {
    if (base.kind !== theirs.kind) {
        return refuse(`the view ${base.id} became a ${theirs.kind}`);
    }
    if (!isCanvasView(base) || !isCanvasView(theirs) || !isCanvasView(mine)) {
        // Everything but a canvas holds one thing, so there is nothing in it that could be added to.
        return same(withoutLabels(base), withoutLabels(theirs)) ? mergeLabels(base, mine, theirs, mine) : refuse(`the view ${base.id} changed`);
    }
    const canvas = mergeCanvas(base, mine, theirs);
    if (!canvas.ok) {
        return canvas;
    }
    const labels = mergeLabels(base, mine, theirs, canvas.view);
    return labels.ok ? { ...canvas, view: labels.view } : labels;
};

const idsOf = (views: readonly ProjectView[], within: ReadonlySet<string>): string[] => views.map((view) => view.id).filter((id) => within.has(id));

const sameOrder = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && left.every((id, index) => id === right[index]);

/*
 * `primary` in its own order, with every id of `secondary` that is missing from it put right after
 * the nearest id before it in `secondary` that already stands, or first when there is none. Only
 * ids in `present` take part: a view deleted on one side has no place to keep.
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
 * Three documents: what the daemon's file held at the rev this client holds (`base`), what is on
 * screen with the person's unsaved edits on top of it (`mine`), and what the daemon has just
 * written (`theirs`). Everything `theirs` has that `base` did not comes over, and so do the name and
 * icon of a view and the order of the list when this client left them as `base` had them (another
 * client renaming or moving views); everything else stays as the person left it, so a drag in
 * progress survives an agent or a second client writing to the same project.
 *
 * Anything else (a node that moved, a deletion, a renamed project, another arrangement, the same
 * label or the order changed on both sides) is a real conflict and goes to the person. The reason
 * names the id that made it one.
 */
export const mergeProject = (base: ProjectContent, mine: ProjectContent, theirs: ProjectContent): ProjectMerge => {
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
    const canvases: Record<string, CanvasAddition> = {};
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
            // Deleted here and untouched there: this client's deletion stands, and takes it with it.
            if (!same(before, view)) {
                return refuse(`the view ${view.id} changed after this client removed it`);
            }
            continue;
        }
        const outcome = mergeView(before, standing, view);
        if (!outcome.ok) {
            return outcome;
        }
        merged.set(view.id, outcome.view);
        if (outcome.addition) {
            canvases[view.id] = outcome.addition;
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
        content: { name: mine.name, color: mine.color, ...(mine.icon ? { icon: mine.icon } : {}), views },
        additions: { views: added, canvases }
    };
};
