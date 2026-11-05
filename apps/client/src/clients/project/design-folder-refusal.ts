import { designFolderOf, designPlaces, isCanvasView, isSharedDesign, type DesignPlace, type ProjectView } from '@ruimte/contracts';

/* The slice of the document store that puts a design back; the real store has more. */
export interface DesignPlacing {
    getState(): {
        shared: string[];
        exportViews(): ProjectView[];
        moveNodeToView(nodeId: string, viewId: string): void;
        openAsView(nodeId: string): string | null;
        putOnCanvas(viewId: string, canvasViewId: string): boolean;
        setShared(id: string, shared: boolean): void;
    };
}

function folderOf(design: DesignPlace, shared: readonly string[]): string {
    return designFolderOf(design, isSharedDesign(design, shared));
}

/*
 * After the machine refused a save because a design's folder would move onto another's, puts every
 * design whose folder moved since the last save back where that save left it: back on its canvas or
 * into a view of its own, and its view or canvas back on its side of the shared file. Without that,
 * every later save would send the same document and be refused too. Answers whether anything moved.
 */
export function restoreDesignFolders(base: { views: readonly ProjectView[]; shared: readonly string[] }, documents: DesignPlacing): boolean {
    const before = new Map(designPlaces(base.views).map((design) => [design.id, design]));
    const designs = designPlaces(documents.getState().exportViews());
    let restored = false;

    for (const design of designs) {
        const was = before.get(design.id);

        if (was === undefined || folderOf(design, documents.getState().shared) === folderOf(was, base.shared)) {
            continue;
        }

        if (was.canvasId !== design.canvasId) {
            const canvasStands = documents
                .getState()
                .exportViews()
                .some((view) => view.id === was.canvasId && isCanvasView(view));

            if (was.canvasId === null) {
                documents.getState().openAsView(design.id);
            } else if (canvasStands && design.canvasId === null) {
                documents.getState().putOnCanvas(design.id, was.canvasId);
            } else if (canvasStands) {
                documents.getState().moveNodeToView(design.id, was.canvasId);
            }
        }

        const now = designPlaces(documents.getState().exportViews()).find((candidate) => candidate.id === design.id);
        // A canvas that went since cannot take the node back, and then its side is no longer the old one's.
        const holder = now !== undefined && now.canvasId === was.canvasId ? (was.canvasId ?? was.id) : null;
        const sharedBefore = holder !== null && base.shared.includes(holder);

        if (holder !== null && documents.getState().shared.includes(holder) !== sharedBefore) {
            documents.getState().setShared(holder, sharedBefore);
        }

        restored = restored || (now !== undefined && folderOf(now, documents.getState().shared) === folderOf(was, base.shared));
    }

    return restored;
}
