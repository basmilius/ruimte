import type { ContextSource } from '@ruimte/contracts';
import { resolveStoredPath } from '@/shell/panels/files-tree';
import { isAgentKind, type CanvasNode, type Edge, type TextElement } from '@/state/canvas';

// A text's first line is its name in the list an agent sees.
const titleOf = (text: string): string => text.split('\n')[0]?.trim().slice(0, 60) || 'Text';

/*
 * What every agent node may read, derived from the edges into it. A line into anything else is
 * only a line. Terminals and chats are read live by the daemon; the rest travels as text. The
 * folder is what turns a file node's stored path into the path the agent's own tools take.
 */
export const deriveContextSources = (
    nodes: Record<string, CanvasNode>,
    texts: Record<string, TextElement>,
    edges: Edge[],
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
        } else if (node && node.kind === 'drawing' && node.viewId) {
            // The view id, not the node id: the daemon reads the file, and two nodes can mirror one.
            source = { id: node.viewId, kind: 'drawing', title: node.title };
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
