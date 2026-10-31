import {
    isCanvasView,
    isDividerView,
    isUnlistedView,
    nodeChats,
    UNKNOWN_KIND,
    type ProjectNode,
    type ProjectReferablesResult,
    type ProjectText,
    type ProjectView
} from '@ruimte/contracts';
import { REFERENCE_ICONS, type Referable, type ReferableKind, type Referables } from '@adecore/agents-react/chat';
import { useReachedProjects, useReachedReferables } from '@/chat/reached-referables';
import { openProject } from '@/project/open';
import { useViewNodes, type NodesOfView } from '@/project/view-nodes';
import { revealNode, showView } from '@/project/views';
import { liveCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { useServers } from '@/state/server';

type ReachedProject = ProjectReferablesResult['projects'][number];

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
    // A chat view stands on no canvas, so it reaches a node through the canvas that node stands on.
    const nodesUnder = (view: ProjectView): Referable[] => {
        if (canvas !== undefined || chatId === '' || !isCanvasView(view) || isUnlistedView(view)) {
            return [];
        }

        const trail = [{ id: view.id, name: view.name, kind: 'canvas' as const }];

        return nodesOf(view).flatMap((node) => {
            const found = node.id === chatId ? null : nodeReferable(node);

            return found === null ? [] : [{ ...found, group: 'views' as const, trail }];
        });
    };
    const offered = views.flatMap((view) => {
        const own = viewReferable(view);

        return own === null ? nodesUnder(view) : [own, ...nodesUnder(view)];
    });
    // A node showing a drawing or a diagram has the id of that view, which is offered once, as a view.
    const viewIds = new Set(views.map((view) => view.id));
    const items = [...onCanvas, ...offered.filter((item) => !taken.has(item.id) && (item.trail === undefined || !viewIds.has(item.id)))];
    const twins = (item: Referable): boolean =>
        items.some((other) => other !== item && other.kind === item.kind && other.name.toLowerCase() === item.name.toLowerCase());
    return items.map((item) => (canvas !== undefined && item.group === 'canvas' && twins(item) ? { ...item, detail: canvas.name } : item));
}

/*
 * The other open projects under a heading each, behind the chat's own project, which keeps the first
 * place. Nothing changes while there is no other project to tell it apart from.
 */
export function withReachedProjects(
    items: readonly Referable[],
    own: { projectId: string; name: string } | null,
    reached: readonly ReachedProject[]
): readonly Referable[] {
    const others = reached.filter(({ project }) => project.projectId !== own?.projectId && project.scratch !== true);

    if (others.length === 0 || own === null) {
        return items;
    }

    const section = { id: own.projectId, name: own.name, current: true };

    return [
        ...items.map((item) => (item.group === 'canvas' ? item : { ...item, section })),
        ...others.flatMap(({ project, items: offered }) => {
            const step = { id: project.projectId, name: project.name, kind: 'project' as const };

            return offered.flatMap((item) => {
                if (!(item.kind in REFERENCE_ICONS) || item.kind === 'project') {
                    return [];
                }

                const inside = item.canvas === undefined ? [] : [{ ...item.canvas, kind: 'canvas' as const }];

                return [
                    {
                        id: item.id,
                        name: item.name,
                        kind: item.kind as ReferableKind,
                        group: 'views' as const,
                        trail: [step, ...inside],
                        section: { id: project.projectId, name: project.name }
                    }
                ];
            });
        })
    ];
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
            return (
                item.id === other.id &&
                item.name === other.name &&
                item.kind === other.kind &&
                item.group === other.group &&
                item.detail === other.detail &&
                item.trail?.map((step) => step.name).join() === other.trail?.map((step) => step.name).join()
            );
        })
    );
}

/* A chip's click: a view opens, a node is zoomed to on its canvas, which comes to the front first. */
function openHere(id: string): void {
    if (useDocument.getState().views.some((view) => view.id === id)) {
        showView(id);
        return;
    }
    revealNode(id);
}

/* A reference in another project opens that project first. */
export function openReference(endpointId: string, id: string): void {
    const elsewhere = useReachedReferables.getState().byEndpoint[endpointId]?.find(({ items }) => items.some((item) => item.id === id));

    if (elsewhere === undefined) {
        openHere(id);
        return;
    }

    void openProject(endpointId, elsewhere.project.projectId).then(() => openHere(id));
}

/* The open project's views and nodes for a chat's `#`; a machine from before `viewReferences` is offered its chats only. */
export function useReferables(endpointId: string, chatId: string): Referables {
    const items = useViewNodes((views, nodesOf) => projectReferables(views, nodesOf, textsOfView, chatId), sameReferables);
    const chatsOnly = useServers((s) => s.byEndpoint[endpointId]?.viewReferences !== true);
    const own = useProject((s) => s.current);
    const reached = useReachedProjects(endpointId);
    return { items: withReachedProjects(items, own, reached), chatsOnly };
}
