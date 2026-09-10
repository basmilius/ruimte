import { isCanvasView, type NodeKind } from '@ruimte/contracts';
import { projectNodes } from '@/project/views';
import { useCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { useSessions } from '@/state/sessions';

/* What ending a node means, injected so the watching itself never touches the transport. */
export type NodeEnder = (id: string, kind: NodeKind) => void;

/*
 * Every node the project holds, on any view, with the kind that says how to end it. A session dies
 * when its id leaves the document, never when it leaves the screen: a view switch takes nodes off
 * the canvas and they have to keep running. The canvas store edits one view at a time and says
 * which one, so its nodes win over the copy the document still holds of that view alone.
 */
const liveNodes = (): Map<string, NodeKind> => {
    const live = new Map<string, NodeKind>();
    for (const node of projectNodes()) {
        live.set(node.id, node.kind);
    }
    for (const view of useDocument.getState().views) {
        if (!isCanvasView(view) && view.kind !== 'separator') {
            // A standalone view is one node without a canvas, under the same id as its session.
            live.set(view.id, view.kind);
        }
    }
    return live;
};

/* Ends every node that leaves the document, so no store talks to the transport itself. */
export const watchNodes = (end: NodeEnder): (() => void) => {
    let previous = liveNodes();
    const step = (changed: boolean, settling: boolean): void => {
        if (!changed) {
            return;
        }
        const current = liveNodes();
        // Another project swapping in is not the person closing nodes; those sessions keep running.
        if (!settling) {
            for (const [id, kind] of previous) {
                if (!current.has(id)) {
                    end(id, kind);
                }
            }
        }
        previous = current;
    };
    const offCanvas = useCanvas.subscribe((state, before) =>
        step(state.nodes !== before.nodes, state.loading || before.loading || useDocument.getState().loading)
    );
    const offDocument = useDocument.subscribe((state, before) =>
        step(state.views !== before.views || state.activeViewId !== before.activeViewId, state.loading || before.loading || useCanvas.getState().loading)
    );
    // Rows keyed by node id say nothing about another project's nodes, and a stale one would show as a status.
    const offProject = useProject.subscribe((state, before) => {
        if (state.current?.projectId !== before.current?.projectId) {
            useSessions.getState().clear();
            useChats.getState().clear();
        }
    });
    return () => {
        offCanvas();
        offDocument();
        offProject();
    };
};
