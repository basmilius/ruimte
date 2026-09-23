import { randomBytes } from 'node:crypto';
import { isAgentKind, isCanvasView, type ProjectCanvasView, type ProjectContent, type ProjectEdge, type ProjectNode } from '@ruimte/contracts';
import { refuseMissingNodes } from './own-view.ts';
import { VerbRefusal, field, orNote } from './verb.ts';

// A plafond, not a budget: it is there to stop an agent in a loop long before a canvas stops drawing.
export const MAX_CANVAS_NODES = 500;

/* The same sentence wherever a canvas is full: what is on it, what this call needs, and the cap. */
export const canvasFull = (canvas: ProjectCanvasView, adding: number): VerbRefusal =>
    new VerbRefusal(
        'canvas-full',
        `${canvas.name} holds ${canvas.nodes.length} nodes and this would add ${adding} more; a canvas holds at most ${MAX_CANVAS_NODES}`
    );

// What a caller may pick instead of a --beside that is nowhere; a full canvas would bury the refusal, so it says where to look.
const BESIDE_LINES_MAX = 20;

/*
 * What a refusal about a node id may offer instead. `takes` is what the verb that refused would
 * actually accept, since an alternative that is refused a line later is worse than no list at all,
 * and `empty` is what to say when that leaves nothing.
 */
export const nodeLines = (canvas: ProjectCanvasView, options: { takes?: (node: ProjectNode) => boolean; empty?: string } = {}): string[] => {
    const nodes = options.takes === undefined ? canvas.nodes : canvas.nodes.filter(options.takes);
    if (nodes.length > BESIDE_LINES_MAX) {
        return [`detail\truimte-context node list\tthe ${canvas.nodes.length} nodes of ${canvas.id}`];
    }
    return orNote(
        nodes.map((node) => `node\t${node.id}\t${node.kind}\t${field(node.title)}`),
        options.empty ?? `${canvas.id} has no nodes on it yet`
    );
};

/* A group is never one of --nodes: `node group` and `node arrange` both refuse one, so neither offers one. */
export const NOT_A_GROUP = {
    takes: (node: ProjectNode): boolean => node.kind !== 'group',
    empty: 'This canvas holds nothing but frames, and a frame is never one of --nodes'
};

/*
 * The ids of a comma-separated flag, in the order they were written and without the repeats: naming
 * a node twice is one node, the way a person's selection holds it once.
 */
export const idList = (raw: string, flag: string): string[] => {
    const ids = [...new Set(raw.split(',').map((id) => id.trim()))];
    if (ids.some((id) => id === '')) {
        throw new VerbRefusal('bad-arguments', `${flag} has an empty id in it; write the ids separated by commas, as a,b,c`);
    }
    return ids;
};

/* The nodes those ids name on this canvas, refused with what this verb takes when one of them names none. */
export const nodesNamed = (
    content: Pick<ProjectContent, 'views'>,
    canvas: ProjectCanvasView,
    ids: readonly string[],
    options: { takes?: (node: ProjectNode) => boolean; empty?: string; cannot?: string } = {}
): ProjectNode[] => {
    const missing = ids.filter((id) => !canvas.nodes.some((node) => node.id === id));
    if (missing.length > 0) {
        throw refuseMissingNodes(content, missing, canvas.id, options.cannot ?? 'there is no node under that id', nodeLines(canvas, options));
    }
    return ids.map((id) => canvas.nodes.find((node) => node.id === id)!);
};

/* Every id the project already uses, since a node id is also a session id and a view id is too. */
const idsIn = (content: ProjectContent): Set<string> => {
    const ids = new Set<string>();
    for (const view of content.views) {
        ids.add(view.id);
        if (isCanvasView(view)) {
            for (const item of [...view.nodes, ...view.texts, ...view.edges]) {
                ids.add(item.id);
            }
        }
    }
    return ids;
};

/* A fresh id in the shape the client's `nextId` gives: a prefix, a dash, eight base-36 characters.
   `also` is what the same mutation already handed out and has not written down yet. */
export const newId = (prefix: string, content: ProjectContent, also: readonly string[] = []): string => {
    const taken = idsIn(content);
    for (const id of also) {
        taken.add(id);
    }
    for (;;) {
        const id = `${prefix}-${Array.from(randomBytes(8), (byte) => (byte % 36).toString(36)).join('')}`;
        if (!taken.has(id)) {
            return id;
        }
    }
};

export const checkUrl = (url: string): string => {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new VerbRefusal('bad-url', `${url} is not a URL; --url takes a whole http or https address, scheme and all`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new VerbRefusal('bad-url', `${url} is not an http or https address; a browser node opens nothing else`);
    }
    return parsed.href;
};

/*
 * The line `node new` draws from whoever called it into what it made. A terminal or a chat reads
 * what a line brings it, so it gets the context line `agent` draws, label and all; nothing else
 * reads, so its line carries the role that says who put the node there and nothing more.
 */
export const openingEdge = (from: string, node: ProjectNode, content: ProjectContent): ProjectEdge => {
    const id = newId('edge', content, [node.id]);
    if (isAgentKind(node.kind)) {
        return { id, from, to: node.id, label: 'context' };
    }
    return { id, from, to: node.id, role: 'origin' };
};
