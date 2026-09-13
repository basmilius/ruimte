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

const mergeView = (base: ProjectView, mine: ProjectView, theirs: ProjectView): ViewMerge => {
    if (base.kind !== theirs.kind) {
        return refuse(`the view ${base.id} became a ${theirs.kind}`);
    }
    if (!isCanvasView(base) || !isCanvasView(theirs) || !isCanvasView(mine)) {
        // Everything but a canvas holds one thing, so there is nothing in it that could be added to.
        return same(base, theirs) ? { ok: true, view: mine, addition: null } : refuse(`the view ${base.id} changed`);
    }
    if (base.name !== theirs.name) {
        return refuse(`the view ${base.id} was renamed to "${theirs.name}"`);
    }
    if (!same(base.icon, theirs.icon) || !same(base.titleSource, theirs.titleSource)) {
        return refuse(`the view ${base.id} changed`);
    }
    return mergeCanvas(base, mine, theirs);
};

/*
 * Three documents: what the daemon's file held at the rev this client holds (`base`), what is on
 * screen with the person's unsaved edits on top of it (`mine`), and what the daemon has just
 * written (`theirs`). The merge only ever adds: everything `theirs` has that `base` did not comes
 * over, and everything else stays as the person left it, so a drag in progress survives an agent
 * writing to the same project.
 *
 * Anything else the daemon did (a node that moved, a deletion, a rename, another arrangement) is a
 * real conflict and goes to the person. The reason names the id that made it one.
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
    const kept = theirs.views.filter((view) => known.has(view.id));
    const lost = base.views.find((view) => !kept.some((candidate) => candidate.id === view.id));
    if (lost) {
        return refuse(`the view ${lost.id} was removed`);
    }
    if (kept.some((view, index) => view.id !== base.views[index]!.id)) {
        return refuse('the views were put in another order');
    }

    const views = [...mine.views];
    const added: ProjectView[] = [];
    const canvases: Record<string, CanvasAddition> = {};
    // Where a view this client does not know goes: after the last view of `theirs` it does know.
    let at = 0;
    for (const view of theirs.views) {
        const standing = views.findIndex((candidate) => candidate.id === view.id);
        const before = known.get(view.id);
        if (before) {
            if (standing === -1) {
                // Deleted here and untouched there: this client's deletion stands, and takes it with it.
                if (!same(before, view)) {
                    return refuse(`the view ${view.id} changed after this client removed it`);
                }
                continue;
            }
            const outcome = mergeView(before, views[standing]!, view);
            if (!outcome.ok) {
                return outcome;
            }
            views[standing] = outcome.view;
            if (outcome.addition) {
                canvases[view.id] = outcome.addition;
            }
            at = standing + 1;
            continue;
        }
        if (standing !== -1) {
            return refuse(`the view ${view.id} arrived, and this client already has one with that id`);
        }
        views.splice(at, 0, view);
        added.push(view);
        at += 1;
    }

    return {
        ok: true,
        content: { name: mine.name, color: mine.color, ...(mine.icon ? { icon: mine.icon } : {}), views },
        additions: { views: added, canvases }
    };
};
