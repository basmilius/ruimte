import type { ActionOutput } from '@ruimte/actions';
import {
    isCanvasView,
    isChatHostView,
    viewChats,
    isHiddenCanvasView,
    isOpenableView,
    isUnknownNode,
    isUnknownView,
    type ProjectCanvasView,
    type ProjectContent,
    type ProjectNode,
    type ProjectSummary,
    type ProjectView
} from '@ruimte/contracts';
import type { VoiceOpenProject } from '../actions/context.ts';
import type { IndexedPlace, ProjectIndex } from '../projects/project-index.ts';

/*
 * What Voice on the daemon reads of a project file: the views a person can open and the nodes of the
 * canvases they see. A hidden canvas (another machine's nodes) and a hidden chat view (an inline edit)
 * are no part of it, so no name of the model ever reaches one.
 */

export type VoiceTarget = ActionOutput<'target.resolve'>['found'][number];
type ViewKind = ActionOutput<'workspace.inspect'>['views'][number]['kind'];
type NodeKind = NonNullable<ActionOutput<'workspace.inspect'>['canvas']>['nodes'][number]['kind'];

/* A chat or a terminal of the project, a node on a canvas or a view of its own. */
export interface VoiceAgentPlace {
    id: string;
    name: string;
    kind: 'chat' | 'terminal';
    viewId: string;
    view: string;
}

const PLACED = { endpointId: null, machine: null };

export function viewKindOf(view: ProjectView): ViewKind {
    return isUnknownView(view) ? 'unknown' : view.kind;
}

export function nodeKindOf(node: ProjectNode): NodeKind {
    return isUnknownNode(node) ? 'unknown' : node.kind;
}

export function openableViews(content: ProjectContent): ProjectView[] {
    return content.views.filter(isOpenableView);
}

export function viewTarget(view: ProjectView): VoiceTarget {
    return { id: view.id, name: view.name ?? view.id, kind: viewKindOf(view), viewId: null, view: null, ...PLACED };
}

export function nodeTarget(node: ProjectNode, view: ProjectView): VoiceTarget {
    return { id: node.id, name: node.title, kind: nodeKindOf(node), viewId: view.id, view: view.name ?? view.id, ...PLACED };
}

/* The canvas of this id when a person sees it; null for none, a hidden one or another kind of view. */
export function visibleCanvas(content: ProjectContent, viewId: string | null): ProjectCanvasView | null {
    const view = viewId === null ? undefined : content.views.find((candidate) => candidate.id === viewId);
    return view !== undefined && isCanvasView(view) && view.hidden !== true ? view : null;
}

/* Every chat and terminal of the project a person sees, in the order of the sidebar and then of each canvas. */
export function projectAgents(content: ProjectContent): VoiceAgentPlace[] {
    return openableViews(content).flatMap((view): VoiceAgentPlace[] => {
        if (view.kind === 'terminal') {
            return [{ id: view.id, name: view.name ?? view.id, kind: 'terminal', viewId: view.id, view: view.name ?? view.id }];
        }
        if (isChatHostView(view)) {
            return viewChats(view).map((chat) => ({ id: chat.id, name: chat.name, kind: 'chat', viewId: view.id, view: view.name }));
        }
        if (!isCanvasView(view)) {
            return [];
        }
        return view.nodes.flatMap((node) =>
            node.kind === 'chat' || node.kind === 'terminal' ? [{ id: node.id, name: node.title, kind: node.kind, viewId: view.id, view: view.name }] : []
        );
    });
}

/* The chat of this id among them, by the name a person reads; null when the project shows no chat of that id. */
export function projectChat(content: ProjectContent, chatId: string): VoiceAgentPlace | null {
    return projectAgents(content).find((agent) => agent.id === chatId && agent.kind === 'chat') ?? null;
}

/* The projects in use on this machine that Voice moves between, the most recently opened first. The Chats project keeps no project of its own, and a folder that went has nothing to read. */
export function openProjects(summaries: readonly ProjectSummary[]): VoiceOpenProject[] {
    return summaries
        .filter((summary) => summary.closedAt == null && summary.available && summary.scratch !== true)
        .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
        .map((summary) => ({ projectId: summary.projectId, name: summary.name, folder: summary.folder }));
}

/*
 * Where the actions of Voice land in a project: the canvas of this id, else the project's first. The
 * canvas another machine draws its nodes on is no place of this machine's, even when the phone names it.
 * Null for a project this machine does not know.
 */
export function voicePlace(index: Pick<ProjectIndex, 'folderOf' | 'viewsOf'>, projectId: string, viewId?: string): IndexedPlace | null {
    const folder = index.folderOf(projectId);
    if (folder === null) {
        return null;
    }
    const canvases = (index.viewsOf(projectId) ?? []).filter(isCanvasView).filter((view): boolean => !isHiddenCanvasView(view));
    const canvas = canvases.find((view) => view.id === viewId) ?? canvases[0] ?? null;
    return { projectId, folder, canvasId: canvas?.id ?? null };
}
