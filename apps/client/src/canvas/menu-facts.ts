import { isCanvasView } from '@ruimte/contracts';
import type { MenuFacts, MenuHost } from '@/commands/menu-context';
import type { SplitDirection } from '@/layout/split';
import { canOpenAsView } from '@/project/views';
import { groupArrangeable } from '@/state/arrange-group';
import { focusedCanvas, maximizedNodeOf, maximizeTargetOf, zoomNodeTargetOf } from '@/state/canvas';
import { cameraHistoryStep } from '@/state/canvas-camera-history';
import { nodeNavigationTarget } from '@/state/canvas-navigation-slice';
import { hasActiveCanvas, useDocument } from '@/state/document';
import { nameOf } from '@/views/active-view';

declare module '@/commands/menu-context' {
    interface MenuFacts {
        /* The nodes selected on the canvas with the focus. */
        selection: number;
        /* The one selected node is an open group whose members can be moved. */
        groupArrangeable: boolean;
        /* The one selected node could open as a view of its own. */
        promote: boolean;
        anyLocked: boolean;
        /* The maximize key acts on a node of the canvas with the focus (`maximizeTargetOf`), not on the cell. */
        nodeMaximizable: boolean;
        /* A node fills that canvas for now. */
        nodeMaximized: boolean;
        nodeZoomable: boolean;
        cameraHistory: { back: boolean; forward: boolean };
        nodeNeighbors: Record<SplitDirection, boolean>;
        /* The same targets as the palette's "Move node to" rows: one node, not a group, another canvas. */
        moveTargets: { id: string; name: string }[];
        layouts: string[];
    }
}

type CanvasFacts = Pick<
    MenuFacts,
    | 'selection'
    | 'groupArrangeable'
    | 'promote'
    | 'anyLocked'
    | 'nodeMaximizable'
    | 'nodeMaximized'
    | 'nodeZoomable'
    | 'cameraHistory'
    | 'nodeNeighbors'
    | 'moveTargets'
    | 'layouts'
>;

const DIRECTIONS: SplitDirection[] = ['left', 'right', 'up', 'down'];

export function canvasFacts(_host: MenuHost): CanvasFacts {
    const documentState = useDocument.getState();
    const canvas = focusedCanvas().getState();
    const onCanvas = hasActiveCanvas(documentState) && documentState.views.some((view) => view.id === documentState.activeViewId && view.kind === 'canvas');
    const selected = canvas.selection.length === 1 ? canvas.nodes[canvas.selection[0]!] : undefined;

    return {
        selection: onCanvas ? canvas.selection.length : 0,
        groupArrangeable: onCanvas && groupArrangeable(selected, canvas.locks),
        promote: onCanvas && selected !== undefined && canOpenAsView(selected.kind),
        anyLocked: Object.values(canvas.locks).some(Boolean),
        nodeMaximizable: onCanvas && maximizeTargetOf(canvas) !== null,
        nodeMaximized: onCanvas && maximizedNodeOf(canvas) !== null,
        nodeZoomable: onCanvas && zoomNodeTargetOf(canvas) !== null,
        cameraHistory: { back: onCanvas && cameraHistoryStep(canvas, -1) !== null, forward: onCanvas && cameraHistoryStep(canvas, 1) !== null },
        nodeNeighbors: Object.fromEntries(DIRECTIONS.map((direction) => [direction, onCanvas && nodeNavigationTarget(canvas, direction) !== null])) as Record<
            SplitDirection,
            boolean
        >,
        moveTargets:
            onCanvas && selected !== undefined && selected.kind !== 'group'
                ? documentState.views
                      .filter((view) => isCanvasView(view) && view.id !== documentState.activeViewId)
                      .map((view) => ({ id: view.id, name: nameOf(view) }))
                : [],
        layouts: onCanvas ? canvas.layouts.map((layout) => layout.name) : []
    };
}
