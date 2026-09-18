import type { ContextSource } from './context.ts';
import { groupMemberIds } from './node-defaults.ts';
import { isCanvasView, type CanvasNodeKind, type ProjectEdge, type ProjectNode, type ProjectText, type ProjectView } from './project.ts';
import { resolveStoredPath } from './stored-path.ts';

/* The kinds an agent lives in; a line that touches one of these is readable context for it. */
export const isAgentKind = (kind: CanvasNodeKind): boolean => kind === 'terminal' || kind === 'chat';

// A text's first line is its name in the list an agent sees.
const titleOf = (text: string): string => text.split('\n')[0]?.trim().slice(0, 60) || 'Text';

/* The thing at one end of a line, or null when it is a node with nothing to read in it. */
const sourceOf = (
    nodes: Readonly<Record<string, ProjectNode>>,
    texts: Readonly<Record<string, ProjectText>>,
    sourceId: string,
    folder: string | null
): ContextSource | null => {
    const node = nodes[sourceId];
    const text = texts[sourceId];
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
    if (node.kind === 'browser' && node.url) {
        // The address travels along, so a read opens with it even when the page itself cannot be reached.
        return { id: node.id, kind: 'browser', title: node.title, text: node.url };
    }
    if (node.kind === 'device' && node.device) {
        // What the node points at, never what it is: the daemon looks the device up at the moment of reading.
        return { id: node.id, kind: 'device', title: node.title, device: node.device };
    }
    return null;
};

/*
 * What the far end of a line makes readable. A group is the corner of the canvas it frames, so it
 * hands over the things inside it, each under its own title, and a frame inside that frame hands
 * over its own in turn: a person who draws a line at the outer one means everything it holds.
 * `framed` keeps that walk finite, since two frames can each hold the other's center.
 */
const sourcesFrom = (
    nodes: Readonly<Record<string, ProjectNode>>,
    texts: Readonly<Record<string, ProjectText>>,
    sourceId: string,
    targetId: string,
    folder: string | null,
    framed: Set<string>
): ContextSource[] => {
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
    const source = sourceOf(nodes, texts, sourceId, folder);
    return source ? [source] : [];
};

/*
 * Which end of a line reads, and what it reads there. Only an agent reads, so a line with an agent
 * at one end alone says the same thing whichever way a person happened to draw it: a note, a page
 * or a device has nothing to read with, and the direction is a detail of the file. With an agent at
 * both ends the direction is the whole point, and there the head reads the tail, as it always did.
 */
const readerOf = (nodes: Readonly<Record<string, ProjectNode>>, edge: ProjectEdge): { agentId: string; sourceId: string } | null => {
    const head = nodes[edge.to];
    if (head && isAgentKind(head.kind)) {
        return { agentId: edge.to, sourceId: edge.from };
    }
    const tail = nodes[edge.from];
    if (tail && isAgentKind(tail.kind)) {
        return { agentId: edge.from, sourceId: edge.to };
    }
    return null;
};

/*
 * What every agent node may read, derived from the lines it sits on. A line between two nodes that
 * neither read is only a line. Terminals, chats and browser pages are read live by the daemon; the
 * rest travels as text. The folder is what turns a file node's stored path into the path the
 * agent's own tools take.
 */
export const deriveContextSources = (
    nodes: Readonly<Record<string, ProjectNode>>,
    texts: Readonly<Record<string, ProjectText>>,
    edges: readonly ProjectEdge[],
    folder: string | null = null
): Map<string, ContextSource[]> => {
    const byTarget = new Map<string, ContextSource[]>();
    for (const edge of edges) {
        const reader = readerOf(nodes, edge);
        if (!reader) {
            continue;
        }
        const current = byTarget.get(reader.agentId) ?? [];
        /* A node reached twice, by a line of its own and by the frame around it, or by two frames,
           is one source: `read` takes an id, and the same id twice in a list is a riddle. */
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
};

const byId = <T extends { id: string }>(items: readonly T[]): Record<string, T> => Object.fromEntries(items.map((item) => [item.id, item]));

/*
 * What every agent node of a project may read, over every canvas view: an agent on a canvas that is
 * not on screen keeps the lines drawn at it. A node id never repeats across the views of one
 * project (the daemon refuses such a file), so the canvases merge without overwriting each other.
 */
export const deriveProjectContextSources = (views: readonly ProjectView[], folder: string | null): Map<string, ContextSource[]> => {
    const merged = new Map<string, ContextSource[]>();
    for (const view of views) {
        if (!isCanvasView(view)) {
            continue;
        }
        for (const [targetId, sources] of deriveContextSources(byId(view.nodes), byId(view.texts), view.edges, folder)) {
            merged.set(targetId, sources);
        }
    }
    return merged;
};
