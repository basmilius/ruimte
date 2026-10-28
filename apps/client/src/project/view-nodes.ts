import { useRef, useSyncExternalStore } from 'react';
import {
    isCanvasView,
    isDesignView,
    isHiddenCanvasView,
    isSessionView,
    sessionKindOfView,
    viewChats,
    type ProjectNode,
    type ProjectView
} from '@ruimte/contracts';
import { defaultCanvases, liveCanvas, subscribeCanvases, type CanvasNode } from '@/state/canvas';
import { shallow } from 'zustand/shallow';
import { useDocument } from '@/state/document';
import type { StatusOf } from '@/state/sessions';

/* A reader of a view's nodes, handed to a pure helper so a test can pass its own. Empty for a view that is no canvas. */
export type NodesOfView<Node = ProjectNode> = (view: ProjectView) => readonly Node[];

const NO_NODES: readonly CanvasNode[] = [];

/* One list per state of an editor, so a reader gets the same array back until a node changes. */
const liveLists = new WeakMap<readonly string[], { nodes: Record<string, CanvasNode>; list: readonly CanvasNode[] }>();

function listOf(order: readonly string[], nodes: Record<string, CanvasNode>): readonly CanvasNode[] {
    const known = liveLists.get(order);
    if (known !== undefined && known.nodes === nodes) {
        return known.list;
    }
    const list = order.flatMap((id) => (nodes[id] ? [nodes[id]] : []));
    liveLists.set(order, { nodes, list });
    return list;
}

/*
 * The nodes of a canvas view, in its order: what its editor holds while the canvas is on screen, in any
 * cell, else what the document has. Every reader goes through here; the file layer that writes the
 * document reads it directly (`view-nodes.test.ts` keeps that list).
 */
export function nodesOfView(view: ProjectView): readonly CanvasNode[] {
    if (!isCanvasView(view)) {
        return NO_NODES;
    }
    const canvas = liveCanvas(view.id);
    // An editor made for a cell holds nothing until its view is loaded into it.
    return canvas === null || canvas.viewId !== view.id ? view.nodes : listOf(canvas.order, canvas.nodes);
}

/* A node as the whole project sees it: enough to have a status and a name, never a place. */
export interface ProjectNodeRef extends StatusOf {
    title: string;
}

/* What a view holds in the words the status needs: a standalone view is one node under its own id. */
export function nodeRefsOfView(view: ProjectView): readonly ProjectNodeRef[] {
    if (isDesignView(view)) {
        return viewChats(view).map((chat) => ({ id: chat.id, kind: 'chat', title: chat.name }));
    }
    return isSessionView(view) ? [{ id: view.id, kind: sessionKindOfView(view), title: view.name }] : nodesOfView(view);
}

/*
 * Every node the project holds, over every view, a standalone view counting as the one node it is.
 * Whatever looks at the whole project (the dock's counters, the notifications, the session
 * lifecycle) reads this rather than the canvas on screen. The canvas of another machine's nodes is left
 * out: they are that machine's to show, and nothing here could open a view for them.
 */
export function projectNodes(): ProjectNodeRef[] {
    return projectNodesIn(useDocument.getState().views);
}

/* The same nodes for a render, again whenever one comes, goes or changes on any canvas on screen or in the document. */
export function useProjectNodes(): readonly ProjectNodeRef[] {
    return useViewNodes(projectNodesIn, sameNodeRefs);
}

function projectNodesIn(views: readonly ProjectView[]): ProjectNodeRef[] {
    return views.filter((view) => !isHiddenCanvasView(view)).flatMap(nodeRefsOfView);
}

// A standalone view's ref is a new object on every read, so the list is the same when every ref holds the same fields.
function sameNodeRefs(before: readonly ProjectNodeRef[], next: readonly ProjectNodeRef[]): boolean {
    return before.length === next.length && before.every((ref, i) => shallow(ref, next[i]));
}

export function subscribeViewNodes(listener: () => void): () => void {
    const offDocument = useDocument.subscribe((state, previous) => {
        if (state.views !== previous.views) {
            listener();
        }
    });
    // A pan or a selection changes no node, and a canvas hears one on every frame.
    const offCanvases = subscribeCanvases((_viewId, state, previous) => {
        if (state.nodes !== previous.nodes || state.order !== previous.order || state.viewId !== previous.viewId) {
            listener();
        }
    });
    const offShape = defaultCanvases.subscribeShape(listener);
    return () => {
        offDocument();
        offCanvases();
        offShape();
    };
}

/*
 * What a component derives from the nodes of the project's views, again whenever a node changes on any
 * canvas on screen or in the document. `select` answers a value or the same objects it was handed:
 * like a `useShallow` selector, a new array or object per call never settles unless `equal` (such as
 * zustand's `shallow`) says it is the same as the last.
 */
export function useViewNodes<T>(
    select: (views: readonly ProjectView[], nodesOf: NodesOfView<CanvasNode>) => T,
    equal: (before: T, next: T) => boolean = Object.is
): T {
    const last = useRef<{ value: T } | null>(null);
    const snapshot = (): T => {
        const next = select(useDocument.getState().views, nodesOfView);
        if (last.current !== null && equal(last.current.value, next)) {
            return last.current.value;
        }
        last.current = { value: next };
        return next;
    };
    return useSyncExternalStore(subscribeViewNodes, snapshot);
}
