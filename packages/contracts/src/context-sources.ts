import type { ContextSource } from './context.ts';
import { isCanvasView, type CanvasNodeKind, type ProjectEdge, type ProjectNode, type ProjectText, type ProjectView } from './project.ts';
import { resolveStoredPath } from './stored-path.ts';

/* The kinds an agent lives in; an edge into one of these is readable context. */
export const isAgentKind = (kind: CanvasNodeKind): boolean => kind === 'terminal' || kind === 'chat';

// A text's first line is its name in the list an agent sees.
const titleOf = (text: string): string => text.split('\n')[0]?.trim().slice(0, 60) || 'Text';

/*
 * What every agent node may read, derived from the edges into it. A line into anything else is
 * only a line. Terminals and chats are read live by the daemon; the rest travels as text. The
 * folder is what turns a file node's stored path into the path the agent's own tools take.
 */
export const deriveContextSources = (
    nodes: Readonly<Record<string, ProjectNode>>,
    texts: Readonly<Record<string, ProjectText>>,
    edges: readonly ProjectEdge[],
    folder: string | null = null
): Map<string, ContextSource[]> => {
    const byTarget = new Map<string, ContextSource[]>();
    for (const edge of edges) {
        const target = nodes[edge.to];
        if (!target || !isAgentKind(target.kind)) {
            continue;
        }
        const node = nodes[edge.from];
        const text = texts[edge.from];
        let source: ContextSource | null = null;
        if (text) {
            source = { id: text.id, kind: 'text', title: titleOf(text.text), text: text.text };
        } else if (node && (node.kind === 'terminal' || node.kind === 'chat')) {
            source = { id: node.id, kind: node.kind, title: node.title };
        } else if (node && node.kind === 'note') {
            source = { id: node.id, kind: 'text', title: node.title, text: node.body ?? '' };
        } else if (node && (node.kind === 'drawing' || node.kind === 'diagram') && node.viewId) {
            // The view id, not the node id: the daemon reads the file, and two nodes can mirror one.
            source = { id: node.viewId, kind: node.kind, title: node.title };
        } else if (node && node.kind === 'file' && node.path) {
            // The path the daemon's machine knows it by, since that is where the agent runs.
            source = { id: node.id, kind: 'file', title: node.title, text: resolveStoredPath(folder, node.path) ?? node.path };
        } else if (node && node.kind === 'browser' && node.url) {
            source = { id: node.id, kind: 'text', title: node.title, text: node.url };
        }
        if (source) {
            byTarget.set(edge.to, [...(byTarget.get(edge.to) ?? []), source]);
        }
    }
    return byTarget;
};

const byId = <T extends { id: string }>(items: readonly T[]): Record<string, T> => Object.fromEntries(items.map((item) => [item.id, item]));

/*
 * What every agent node of a project may read, over every canvas view: an agent on a canvas that is
 * not on screen keeps the lines drawn into it. A node id never repeats across the views of one
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
