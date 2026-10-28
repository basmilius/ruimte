import { isCanvasView, isDividerView, isUnlistedView, nodeChats, UNKNOWN_KIND, type ProjectNode, type ProjectText, type ProjectView } from '@ruimte/contracts';
import type { Referable, ReferableKind, Referables } from '@adecore/agents-react/chat';
import { useViewNodes, type NodesOfView } from '@/project/view-nodes';
import { revealNode, showView } from '@/project/views';
import { liveCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useServers } from '@/state/server';

/* A reader of a canvas view's texts, handed in so a test can pass its own. */
type TextsOfView = (view: ProjectView) => readonly ProjectText[];

// A text's first line is its name, as the daemon names it to an agent.
function textName(text: string): string {
    return text.split('\n')[0]?.trim().slice(0, 60) ?? '';
}

/*
 * A node as a `#` reaches it, or null for one no verb reaches: a group, a node with nothing to read,
 * one on another machine. A node showing a drawing or a diagram stands for that view.
 */
function nodeReferable(node: Pick<ProjectNode, 'id' | 'kind' | 'title' | 'viewId' | 'path' | 'device' | 'machine'>): Omit<Referable, 'group'> | null {
    if (node.machine !== undefined) {
        return null;
    }
    switch (node.kind) {
        case 'chat':
        case 'terminal':
        case 'note':
        case 'browser':
            return { id: node.id, name: node.title, kind: node.kind };
        case 'design':
            // A design is reached as its own chat, under the node's id.
            return { id: node.id, name: node.title, kind: 'chat' };
        case 'drawing':
        case 'diagram':
            return node.viewId ? { id: node.viewId, name: node.title, kind: node.kind } : null;
        case 'file':
            return node.path ? { id: node.id, name: node.title, kind: 'file' } : null;
        case 'device':
            return node.device ? { id: node.id, name: node.title, kind: 'device' } : null;
        default:
            return null;
    }
}

const VIEW_KINDS: ReadonlySet<string> = new Set<ReferableKind>(['canvas', 'chat', 'terminal', 'browser', 'device', 'drawing', 'diagram', 'file', 'database']);

function viewReferable(view: ProjectView): Referable | null {
    if (isDividerView(view) || isUnlistedView(view) || view.kind === UNKNOWN_KIND || !VIEW_KINDS.has(view.kind)) {
        return null;
    }
    return { id: view.id, name: view.name, kind: view.kind as ReferableKind, group: 'views' };
}

/*
 * What a message of `chatId` may point at with `#`: the nodes and texts of the canvas it is a node of,
 * then the views in sidebar order, never the chat itself. Two of one name and kind are told apart by
 * the canvas the node stands on.
 */
export function projectReferables(views: readonly ProjectView[], nodesOf: NodesOfView<ProjectNode>, textsOf: TextsOfView, chatId: string): Referable[] {
    // A later chat of a design node is no node of its own, so the canvas is the one its design stands on.
    const canvas = views.find(
        (view) => isCanvasView(view) && !isUnlistedView(view) && nodesOf(view).some((node) => nodeChats(node).some((chat) => chat.id === chatId))
    );
    const onCanvas: Referable[] =
        canvas === undefined
            ? []
            : [
                  ...nodesOf(canvas).flatMap((node) => {
                      const found = node.id === chatId ? null : nodeReferable(node);
                      return found === null ? [] : [{ ...found, group: 'canvas' as const }];
                  }),
                  ...textsOf(canvas).map((text) => ({ id: text.id, name: textName(text.text), kind: 'text' as const, group: 'canvas' as const }))
              ];
    const taken = new Set([chatId, ...onCanvas.map((item) => item.id)]);
    const items = [...onCanvas, ...views.flatMap((view) => viewReferable(view) ?? []).filter((item) => !taken.has(item.id))];
    const twins = (item: Referable): boolean =>
        items.some((other) => other !== item && other.kind === item.kind && other.name.toLowerCase() === item.name.toLowerCase());
    return items.map((item) => (canvas !== undefined && item.group === 'canvas' && twins(item) ? { ...item, detail: canvas.name } : item));
}

/* The texts of a canvas view: what its editor holds while it is on screen, else what the document has. */
function textsOfView(view: ProjectView): readonly ProjectText[] {
    if (!isCanvasView(view)) {
        return [];
    }
    const live = liveCanvas(view.id);
    return live === null || live.viewId !== view.id ? view.texts : Object.values(live.texts);
}

function sameReferables(before: readonly Referable[], next: readonly Referable[]): boolean {
    return (
        before.length === next.length &&
        before.every((item, i) => {
            const other = next[i]!;
            return item.id === other.id && item.name === other.name && item.kind === other.kind && item.group === other.group && item.detail === other.detail;
        })
    );
}

/* A chip's click: a view opens, a node is zoomed to on its canvas, which comes to the front first. */
export function openReference(_endpointId: string, id: string): void {
    if (useDocument.getState().views.some((view) => view.id === id)) {
        showView(id);
        return;
    }
    revealNode(id);
}

/* The open project's views and nodes for a chat's `#`; a machine from before `viewReferences` is offered its chats only. */
export function useReferables(endpointId: string, chatId: string): Referables {
    const items = useViewNodes((views, nodesOf) => projectReferables(views, nodesOf, textsOfView, chatId), sameReferables);
    const chatsOnly = useServers((s) => s.byEndpoint[endpointId]?.viewReferences !== true);
    return { items, chatsOnly };
}
