import { designFolderOf, designPlaces, isCanvasView, isSharedDesign, resolveStoredPath, type DesignPlace, type ProjectView } from '@ruimte/contracts';
import { nodesOfView, useViewNodes, type NodesOfView } from '@/project/view-nodes';
import type { CanvasNode } from '@/state/canvas-model';
import { useDocument } from '@/state/document';
import { shownFolderOf, useProject } from '@/state/project';

/* Every design of the project, a node's as the editor of its canvas holds it now, ahead of the document. */
function liveDesignPlaces(views: readonly ProjectView[], nodesOf: NodesOfView<CanvasNode>): DesignPlace[] {
    return designPlaces(views.map((view) => (isCanvasView(view) ? { ...view, nodes: [...nodesOf(view)] } : view)));
}

// A place is a new object on every read; the same design reads the same text.
function sameDesign(before: DesignPlace | null, next: DesignPlace | null): boolean {
    return before === next || (before !== null && next !== null && JSON.stringify(before) === JSON.stringify(next));
}

function placeHolding(designs: readonly DesignPlace[], chatId: string): DesignPlace | null {
    return designs.find((design) => design.chats.some((chat) => chat.id === chatId)) ?? null;
}

/* The design of this id, a view of its own or a node on a canvas; null for anything else. */
export function useDesignPlace(id: string): DesignPlace | null {
    return useViewNodes((views, nodesOf) => liveDesignPlaces(views, nodesOf).find((design) => design.id === id) ?? null, sameDesign);
}

/* The design a chat of this id works on, as its own or a later chat; null for any other chat. */
export function useDesignOfChat(chatId: string): DesignPlace | null {
    return useViewNodes((views, nodesOf) => placeHolding(liveDesignPlaces(views, nodesOf), chatId), sameDesign);
}

/*
 * Where a design's pages are: `location` relative to the project folder as a person reads it, `folder` on
 * the machine, null while the project has no folder there, and the project folder a watch covers it from.
 */
export function useDesignFolder(design: Pick<DesignPlace, 'id' | 'path' | 'canvasId'>): {
    location: string;
    folder: string | null;
    projectFolder: string | null;
} {
    const projectFolder = useProject((s) => shownFolderOf(s.current));
    const shared = useDocument((s) => isSharedDesign(design, s.shared));
    const location = designFolderOf(design, shared);

    return { location, folder: resolveStoredPath(projectFolder, location), projectFolder };
}

/* The same, read once outside a render. */
export function readDesignOfChat(chatId: string): DesignPlace | null {
    return placeHolding(liveDesignPlaces(useDocument.getState().views, nodesOfView), chatId);
}
