import {
    designNodeChats,
    isCanvasView,
    isDesignView,
    isSessionView,
    mapDesignChats,
    sessionKindOfView,
    withNodeAsView,
    withNodeOnView,
    withViewAsNode,
    type ProjectCanvasView,
    type ProjectView,
    type SplitLayout
} from '@ruimte/contracts';
import { activateTab, closeTab, locateView, replaceViewId } from '@/shell/split';
import type { DocumentState } from '@/state/document';
import { centerOfView, withRenamedNode, type DocumentKit } from '@/state/document-model';
import { defaultNodeSize, machineNodeSizes } from '@/state/node-size';

/*
 * A view that became a node leaves the grid with the list: the cell it stood in takes the canvas,
 * or, when the canvas stands in a cell already, that cell takes the focus. Null when it stood nowhere.
 */
function layoutWithCanvasFor(layout: SplitLayout, viewId: string, canvasViewId: string): SplitLayout | null {
    if (locateView(layout, viewId) === null) {
        return null;
    }
    if (locateView(layout, canvasViewId) === null) {
        return activateTab(replaceViewId(layout, viewId, canvasViewId), canvasViewId);
    }
    const without = closeTab(layout, viewId);
    return without === null ? null : activateTab(without, canvasViewId);
}

/* A canvas on screen is its editor, which would otherwise write the canvas back as it was; it keeps its camera. */
function reloadShownCanvas(peers: DocumentKit['peers'], views: readonly ProjectView[], viewId: string): void {
    const editor = peers.canvases.peek(viewId);
    if (!editor) {
        return;
    }
    const after = views.find((view) => view.id === viewId);
    editor.getState().loadView(after && isCanvasView(after) ? after : null, { camera: editor.getState().viewCamera(), focusedNodeId: null });
}

function canvasHolding(views: readonly ProjectView[], nodeId: string): ProjectCanvasView | undefined {
    return views.filter(isCanvasView).find((view) => view.nodes.some((node) => node.id === nodeId));
}

/* Nodes moving between views: to another canvas, off a canvas into a view of their own, and back. */
export function createDocumentNodesSlice({
    set,
    get,
    peers,
    commit,
    write
}: DocumentKit): Pick<DocumentState, 'moveNodeToView' | 'renameNodeOnView' | 'updateStandalone' | 'openAsView' | 'putOnCanvas'> {
    return {
        moveNodeToView(nodeId, viewId) {
            const state = get();
            const views = state.exportViews();
            const source = canvasHolding(views, nodeId);
            const size = source?.nodes.find((candidate) => candidate.id === nodeId);
            const moved = withNodeOnView(views, nodeId, viewId, centerOfView(viewId, state.viewLocal[viewId], size ?? { w: 0, h: 0 }, peers) ?? undefined);
            if (moved === null || !source) {
                return;
            }
            write(moved.views);
            reloadShownCanvas(peers, moved.views, source.id);
            // A target on screen holds its nodes in its editor, which would write the canvas back without this one.
            reloadShownCanvas(peers, moved.views, viewId);
        },

        renameNodeOnView(viewId, nodeId, title, source = 'user') {
            const editor = peers.canvases.peek(viewId);
            if (editor) {
                editor.getState().renameNode(nodeId, title, source);
                return;
            }
            write(withRenamedNode(get().views, viewId, nodeId, title, source));
        },

        updateStandalone(id, patch) {
            const { url: _url, artifact: _artifact, ...chatPatch } = patch;
            set((state) => ({
                views: state.views.map((view) => {
                    // A later chat of a design view keeps what it carries in the view's list of chats.
                    if (view.id !== id && isDesignView(view) && designNodeChats(view).some((chat) => chat.id === id)) {
                        return {
                            ...view,
                            chats: mapDesignChats(view.chats ?? [], (chat) => (chat.id === id ? { ...chat, node: { ...chat.node, ...chatPatch } } : chat))
                        };
                    }
                    if (view.id !== id) {
                        return view;
                    }
                    if (view.kind === 'artifact') {
                        return patch.artifact === undefined ? view : { ...view, node: { ...view.node, artifact: patch.artifact } };
                    }
                    if (!isSessionView(view)) {
                        return view;
                    }
                    if (view.kind === 'browser') {
                        return patch.url === undefined ? view : { ...view, url: patch.url };
                    }
                    if (view.kind === 'device') {
                        return view;
                    }
                    const { url: _url, ...node } = patch;
                    return { ...view, node: { ...view.node, ...node } };
                }),
                edits: state.edits + 1
            }));
        },

        openAsView(nodeId) {
            const views = get().exportViews();
            const source = canvasHolding(views, nodeId);
            const promoted = withNodeAsView(views, nodeId);
            if (promoted === null || !source) {
                return null;
            }
            write(promoted.views);
            reloadShownCanvas(peers, promoted.views, source.id);
            get().setActiveView(promoted.view.id);
            return promoted.view.id;
        },

        putOnCanvas(viewId, canvasViewId) {
            const state = get();
            const views = state.exportViews();
            const source = views.find((view) => view.id === viewId);
            // A design lands as a design node, the size of its own kind and not of the chat it holds.
            const size = source && isSessionView(source) ? defaultNodeSize(source.kind === 'design' ? 'design' : sessionKindOfView(source)) : { w: 0, h: 0 };
            const at = centerOfView(canvasViewId, state.viewLocal[canvasViewId], size, peers) ?? { x: 0, y: 0 };
            const landed = withViewAsNode(views, viewId, canvasViewId, at, machineNodeSizes());
            if (landed === null) {
                return false;
            }
            const { views: next, node } = landed;
            const { [viewId]: _gone, ...viewLocal } = state.viewLocal;
            set({ views: next, viewLocal, edits: state.edits + 1 });
            reloadShownCanvas(peers, next, canvasViewId);
            const layout = state.layout === null ? null : layoutWithCanvasFor(state.layout, viewId, canvasViewId);
            if (layout !== null) {
                commit(layout);
            } else {
                get().setActiveView(canvasViewId);
            }
            const editor = peers.canvases.peek(canvasViewId);
            editor?.getState().select([node.id]);
            editor?.getState().goToNode(node.id);
            return true;
        }
    };
}
