import { isSessionView, type CanvasNodeKind } from '@ruimte/contracts';
import { nodesOfView } from '@/project/view-deletion';
import { projectNodes } from '@/project/views';
import { liveCanvases, subscribeCanvases } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useEndpoints } from '@/state/endpoints';
import { currentEndpointId, endpointKey, splitKey } from '@/state/keys';

/*
 * How a node left the document. `closed` is this client taking it out, which ends its session. `gone`
 * is another writer's change taken in: an agent never ends another node's session, so all that goes
 * is what this client held for it.
 */
export type NodeExit = 'closed' | 'gone';

/* What ending a node means, injected so the watching itself never touches the transport. */
export type NodeEnder = (endpointId: string, id: string, kind: CanvasNodeKind, exit: NodeExit) => void;

/*
 * Every node the project holds, on any view, keyed on the machine it runs on, with the kind that says
 * how to end it. A session dies when its id leaves the document, not when it leaves the screen, since a
 * view switch takes nodes off the canvas while they keep running. The canvas store edits one view at a
 * time and says which one, so its nodes win over the document's own copy of that view.
 */
const liveNodes = (): Map<string, CanvasNodeKind> => {
    const endpointId = currentEndpointId();
    const live = new Map<string, CanvasNodeKind>();
    for (const node of projectNodes()) {
        live.set(endpointKey(endpointId, node.id), node.kind);
    }
    for (const view of useDocument.getState().views) {
        if (isSessionView(view)) {
            // A standalone view is one node without a canvas, under the same id as its session.
            live.set(endpointKey(endpointId, view.id), view.kind);
        }
    }
    // A deleted view that can still be taken back keeps what runs on it until it is purged.
    for (const { view } of useDocument.getState().trashed) {
        for (const node of nodesOfView(view)) {
            live.set(endpointKey(endpointId, node.id), node.kind);
        }
    }
    return live;
};

/* Ends every node that leaves the document, so no store talks to the transport itself. */
export const watchNodes = (end: NodeEnder): (() => void) => {
    let previous = liveNodes();
    const step = (changed: boolean, settling: boolean, merging: boolean): void => {
        if (!changed) {
            return;
        }
        const current = liveNodes();
        // Another project swapping in is not the person closing nodes; those sessions keep running.
        if (!settling) {
            for (const [key, kind] of previous) {
                if (!current.has(key)) {
                    const { endpointId, id } = splitKey(key);
                    end(endpointId, id, kind, merging ? 'gone' : 'closed');
                }
            }
        }
        previous = current;
    };
    /* The nodes of every canvas on screen, so a cell beside the focused one counts as well. */
    let nodesSeen = new Map<string, unknown>();
    const nodesMoved = (): boolean => {
        const next = new Map<string, unknown>(liveCanvases().map(([viewId, state]) => [viewId, state.nodes]));
        const same = next.size === nodesSeen.size && [...next].every(([viewId, nodes]) => nodesSeen.get(viewId) === nodes);
        nodesSeen = next;
        return !same;
    };
    const canvasLoading = (): boolean => liveCanvases().some(([, state]) => state.loading);
    const canvasMerging = (): boolean => liveCanvases().some(([, state]) => state.merging);
    nodesMoved();
    const offCanvas = subscribeCanvases(() =>
        step(nodesMoved(), canvasLoading() || useDocument.getState().loading, canvasMerging() || useDocument.getState().merging)
    );
    const offDocument = useDocument.subscribe((state, before) =>
        step(
            state.views !== before.views || state.trashed !== before.trashed || state.activeViewId !== before.activeViewId,
            state.loading || before.loading || canvasLoading(),
            state.merging || canvasMerging()
        )
    );
    /* Another machine is another project on another daemon. What this one holds keeps running, and
       what the next one holds was never this watcher's to end. */
    const offEndpoint = useEndpoints.subscribe((state, before) => {
        if (state.activeId !== before.activeId) {
            previous = new Map();
        }
    });
    return () => {
        offCanvas();
        offDocument();
        offEndpoint();
    };
};
