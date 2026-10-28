import type { ContextSource } from './context.ts';
import { groupMemberIds } from './node-defaults.ts';
import {
    designNodeChats,
    isCanvasView,
    nodeChats,
    type CanvasNodeKind,
    type ProjectCanvasView,
    type ProjectEdge,
    type ProjectNode,
    type ProjectText,
    type ProjectView
} from './project.ts';
import { resolveStoredPath } from './stored-path.ts';

/* The kinds an agent lives in; a line that touches one of these is readable context for it. */
export function isAgentKind(kind: CanvasNodeKind): boolean {
    return kind === 'terminal' || kind === 'chat' || kind === 'design';
}

// A text's first line is its name in the list an agent sees.
function titleOf(text: string): string {
    return text.split('\n')[0]?.trim().slice(0, 60) || 'Text';
}

/* The things at one end of a line: one for most, every chat of a design node, none for a node with nothing to read in it. */
function sourcesOf(
    nodes: Readonly<Record<string, ProjectNode>>,
    texts: Readonly<Record<string, ProjectText>>,
    sourceId: string,
    folder: string | null
): ContextSource[] {
    const node = nodes[sourceId];
    if (node?.kind === 'design') {
        return nodeChats(node).map((chat) => ({ id: chat.id, kind: 'chat', title: chat.name }));
    }
    const source = sourceOf(node, texts[sourceId], folder);
    return source ? [source] : [];
}

function sourceOf(node: ProjectNode | undefined, text: ProjectText | undefined, folder: string | null): ContextSource | null {
    if (text) {
        return { id: text.id, kind: 'text', title: titleOf(text.text), text: text.text };
    }
    if (!node) {
        return null;
    }
    if (node.kind === 'terminal' || node.kind === 'chat') {
        return { id: node.id, kind: node.kind, title: node.title };
    }
    if (node.kind === 'note') {
        return { id: node.id, kind: 'text', title: node.title, text: node.body ?? '' };
    }
    if ((node.kind === 'drawing' || node.kind === 'diagram') && node.viewId) {
        // The view id, not the node id: the daemon reads the file, and two nodes can mirror one.
        return { id: node.viewId, kind: node.kind, title: node.title, nodeId: node.id };
    }
    if (node.kind === 'file' && node.path) {
        // The path the daemon's machine knows it by, since that is where the agent runs.
        return { id: node.id, kind: 'file', title: node.title, text: resolveStoredPath(folder, node.path) ?? node.path };
    }
    if (node.kind === 'browser') {
        /* The address travels along, so a read opens with it even when the page itself cannot be
           reached. A node without one is a source all the same: it is a page an agent may send somewhere. */
        return { id: node.id, kind: 'browser', title: node.title, text: node.url ?? '' };
    }
    if (node.kind === 'artifact' && node.artifact) {
        return { id: node.id, kind: 'artifact', title: node.title, artifact: node.artifact };
    }
    if (node.kind === 'routine' && node.routine) {
        return { id: node.id, kind: 'routine', title: node.title, routine: node.routine };
    }
    if (node.kind === 'device' && node.device) {
        // What the node points at, never what it is: the daemon looks the device up at the moment of reading.
        return { id: node.id, kind: 'device', title: node.title, device: node.device };
    }
    return null;
}

/*
 * A group hands over everything inside it, nested frames included: a line to the outer one means all
 * it holds. `framed` keeps the walk finite, since two frames can each hold the other's center.
 */
function sourcesFrom(
    nodes: Readonly<Record<string, ProjectNode>>,
    texts: Readonly<Record<string, ProjectText>>,
    sourceId: string,
    targetId: string,
    folder: string | null,
    framed: Set<string>
): ContextSource[] {
    const node = nodes[sourceId];
    if (node && node.kind === 'group') {
        if (framed.has(node.id)) {
            return [];
        }
        framed.add(node.id);
        const members = groupMemberIds(node, [...Object.values(nodes), ...Object.values(texts)]);
        // The agent standing in the frame is not context for itself.
        return members.filter((memberId) => memberId !== targetId).flatMap((memberId) => sourcesFrom(nodes, texts, memberId, targetId, folder, framed));
    }
    return sourcesOf(nodes, texts, sourceId, folder);
}

/*
 * Only an agent reads, so with one agent on a line the direction does not matter. With an agent at both
 * ends the head reads the tail.
 */
function readerOf(nodes: Readonly<Record<string, ProjectNode>>, edge: ProjectEdge): { agentId: string; sourceId: string } | null {
    const head = nodes[edge.to];
    if (head && isAgentKind(head.kind)) {
        return { agentId: edge.to, sourceId: edge.from };
    }
    const tail = nodes[edge.from];
    if (tail && isAgentKind(tail.kind)) {
        return { agentId: edge.from, sourceId: edge.to };
    }
    return null;
}

/*
 * Terminals, chats and browser pages are read live by the daemon; the rest travels as text. The folder
 * turns a file node's stored path into the path the agent's own tools take.
 */
export function deriveContextSources(
    nodes: Readonly<Record<string, ProjectNode>>,
    texts: Readonly<Record<string, ProjectText>>,
    edges: readonly ProjectEdge[],
    folder: string | null = null
): Map<string, ContextSource[]> {
    const byTarget = new Map<string, ContextSource[]>();
    for (const edge of edges) {
        const reader = readerOf(nodes, edge);
        if (!reader) {
            continue;
        }
        const current = byTarget.get(reader.agentId) ?? [];
        // A node reached by a line and by a frame, or by two frames, is one source: `read` takes an id.
        const known = new Set(current.map((source) => source.id));
        const added: ContextSource[] = [];
        for (const source of sourcesFrom(nodes, texts, reader.sourceId, reader.agentId, folder, new Set())) {
            if (!known.has(source.id)) {
                known.add(source.id);
                added.push(source);
            }
        }
        if (added.length > 0) {
            byTarget.set(reader.agentId, [...current, ...added]);
        }
    }
    return byTarget;
}

function byId<T extends { id: string }>(items: readonly T[]): Record<string, T> {
    return Object.fromEntries(items.map((item) => [item.id, item]));
}

/*
 * Every node and text of one canvas as a source, whatever lines it has: what a chat view that names
 * the canvas reads, since no line runs to a view. A group hands over nothing of its own.
 */
export function canvasContextSources(view: ProjectCanvasView, folder: string | null = null): ContextSource[] {
    const nodes = byId(view.nodes);
    const texts = byId(view.texts);
    return [...view.nodes, ...view.texts].flatMap((item) => sourcesOf(nodes, texts, item.id, folder));
}

// A node id never repeats across a project's views (the daemon refuses such a file), so the canvases merge safely.
export function deriveProjectContextSources(views: readonly ProjectView[], folder: string | null): Map<string, ContextSource[]> {
    const merged = new Map<string, ContextSource[]>();
    for (const view of views) {
        if (!isCanvasView(view)) {
            continue;
        }
        for (const [targetId, sources] of deriveContextSources(byId(view.nodes), byId(view.texts), view.edges, folder)) {
            merged.set(targetId, sources);
        }
        // A design node's later chats work on the same design, so they read what a line brings the node.
        for (const node of view.nodes) {
            const sources = merged.get(node.id);
            if (sources === undefined) {
                continue;
            }
            for (const chat of designNodeChats(node)) {
                merged.set(chat.id, sources);
            }
        }
    }
    return merged;
}
