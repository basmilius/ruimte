import { isCanvasView, isDiagramView, isDrawingView, type ProjectView } from '@ruimte/contracts';
import { focusedCanvas, type CanvasNode, type CanvasState } from '@/state/canvas';
import { currentEndpointId } from '@/state/current-endpoint';
import { useDocument, type DocumentState } from '@/state/document';
import { isScratchProject, shownFolderOf, useProject } from '@/state/project';
import { windowWorkspace } from '@/workspace/window';

/*
 * What the window stands on right now, read the first time a command asks and then kept for the one
 * palette build or key press. The facts a command needs of its own feature it reads from its own stores.
 */
export class CommandMoment {
    private canvasState: CanvasState | null = null;
    private documentState: DocumentState | null = null;

    /* The start screen is outside every project, so only the commands about the window are offered there. */
    get inWorkspace(): boolean {
        return windowWorkspace() !== null;
    }

    get endpointId(): string {
        return currentEndpointId();
    }

    /* The folder a person may see, or null for the Chats project and for a project without one. */
    get folder(): string | null {
        return shownFolderOf(useProject.getState().current);
    }

    get scratch(): boolean {
        return isScratchProject(useProject.getState().current);
    }

    get document(): DocumentState {
        return (this.documentState ??= useDocument.getState());
    }

    get canvas(): CanvasState {
        return (this.canvasState ??= focusedCanvas().getState());
    }

    get activeView(): ProjectView | null {
        return this.document.views.find((view) => view.id === this.document.activeViewId) ?? null;
    }

    /* A row that writes into a canvas is offered only while one is on screen. */
    get onCanvas(): boolean {
        const view = this.activeView;

        return view !== null && isCanvasView(view);
    }

    get drawing(): boolean {
        const view = this.activeView;

        return view !== null && isDrawingView(view);
    }

    get diagram(): boolean {
        const view = this.activeView;

        return view !== null && isDiagramView(view);
    }

    /* The one selected node of the canvas with the focus. */
    get selected(): CanvasNode | undefined {
        const { selection, nodes } = this.canvas;

        return selection.length === 1 ? nodes[selection[0]!] : undefined;
    }
}
