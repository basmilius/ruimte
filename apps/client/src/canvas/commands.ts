import { isInFloatingLayer } from '@adecore/ui';
import { isCanvasView, isDiagramView, isDrawingView } from '@ruimte/contracts';
import i18next from 'i18next';
import { ArrowRight, LayoutDashboard, Trash } from 'lucide-react';
import {
    arrangeGroupAction,
    createNodeAction,
    createTextAction,
    fitAction,
    groupSelectionAction,
    applyLayoutAction,
    deleteLayoutAction,
    historyAction,
    moveNodeToViewAction,
    setLocksAction
} from '@/action-port/person-actions';
import { toWorld } from '@/canvas-model/math';
import { layoutDialog } from '@/canvas/dialogs';
import { isNotePreviewLocked, setNotePreviewLocked } from '@/canvas/note-previews';
import { focusedChatTextSize, resetChatTextSize } from '@/chat/text-size';
import { defineBehaviors, type Command, type CommandBehavior, type KeyPress } from '@/commands/behavior';
import type { GeneratedCommands } from '@/commands/generated';
import { keyboardOnCanvas, keyFree, onStandaloneView } from '@/commands/key-context';
import type { CommandMoment } from '@/commands/moment';
import type { SplitDirection } from '@/layout/split';
import { undoLatestDeletion } from '@/project/view-trash';
import { askOpenAsView, canOpenAsView } from '@/project/views';
import { groupArrangeable } from '@/state/arrange-group';
import { focusedCanvas, maximizedNodeOf, maximizeTargetOf, zoomNodeTargetOf } from '@/state/canvas';
import { cameraHistoryStep } from '@/state/canvas-camera-history';
import { focusedDiagram } from '@/state/diagram';
import { activeViewOf, useDocument } from '@/state/document';
import { focusedDrawing } from '@/state/drawing';
import { useUi } from '@/state/ui';
import { isTypingTarget } from '@/surface/canvas/typing-target';

function takeKey(press: KeyPress, run: () => void): true {
    press.event.preventDefault();
    run();

    return true;
}

/* A drawing has a camera of its own, so the same three rows act on whichever is on screen. */
function zoomTarget() {
    const view = activeViewOf(useDocument.getState());
    if (view && isDrawingView(view)) {
        return focusedDrawing().getState();
    }

    return view && isDiagramView(view) ? focusedDiagram().getState() : focusedCanvas().getState();
}

function centerWorld() {
    const canvas = focusedCanvas().getState();

    return toWorld(canvas.camera, { x: canvas.viewport.w / 2, y: canvas.viewport.h / 2 });
}

/*
 * A key that acts on the canvas under the keyboard, or on a diagram, which has an undo and a camera of its
 * own and nothing else a key reaches. A drawing binds its keys in its view, since it has the keyboard the
 * way a terminal has it.
 */
function onCanvasKey(canvasRun: () => void, diagramRun?: () => void): CommandBehavior['key'] {
    return (press) => {
        const active = activeViewOf(useDocument.getState());
        if (diagramRun !== undefined && active !== null && isDiagramView(active)) {
            if (!isTypingTarget(press.event.target) && keyFree(press.event.target)) {
                takeKey(press, diagramRun);
            }

            return true;
        }
        if (keyboardOnCanvas(press.event.target, focusedCanvas().getState())) {
            takeKey(press, canvasRun);
        }

        return true;
    };
}

function addingNode(kind: Parameters<typeof createNodeAction>[0]): CommandBehavior {
    return {
        keyTier: 'canvas',
        run: () => void createNodeAction(kind),
        offered: (moment) => moment.onCanvas,
        key: onCanvasKey(() => void createNodeAction(kind))
    };
}

function selecting(direction: SplitDirection): CommandBehavior {
    return {
        keyTier: 'canvas',
        run: () => focusedCanvas().getState().selectNeighbor(direction),
        offered: (moment) => moment.onCanvas,
        // Alt+Left is browser Back on Windows and Linux, even at the edge of the canvas.
        key: onCanvasKey(() => focusedCanvas().getState().selectNeighbor(direction))
    };
}

function steppingCamera(delta: -1 | 1): CommandBehavior {
    return {
        run: () => focusedCanvas().getState().stepCamera(delta),
        offered: (moment) => moment.onCanvas,
        // Mod+Alt+[ and ] because Mod+[ and ] belong to a page, the editor's history and a drawing's order.
        key: (press) => {
            const canvas = focusedCanvas().getState();
            if (keyFree(press.event.target) && !onStandaloneView() && cameraHistoryStep(canvas, delta) !== null) {
                takeKey(press, () => canvas.stepCamera(delta));
            }

            return true;
        }
    };
}

function zoomable(moment: { onCanvas: boolean; drawing: boolean; diagram: boolean }): boolean {
    return moment.onCanvas || moment.drawing || moment.diagram;
}

export const CANVAS_BEHAVIORS = defineBehaviors({
    'edit-undo': {
        keyTier: 'canvas',
        run: () => {
            if (!undoLatestDeletion(useDocument)) {
                historyAction('undo');
            }
        },
        key: onCanvasKey(
            () => historyAction('undo'),
            () => historyAction('undo')
        ),
        // A deleted view comes back before any history hears the key: the deletion is the newest step there is.
        captureKey: (press) =>
            !press.event.isComposing && !isTypingTarget(press.event.target) && !isInFloatingLayer(press.event.target) && undoLatestDeletion(useDocument)
    },
    'edit-redo': {
        keyTier: 'canvas',
        run: () => historyAction('redo'),
        key: onCanvasKey(
            () => historyAction('redo'),
            () => historyAction('redo')
        )
    },
    'node-maximize': {
        run: () => {
            const target = maximizeTargetOf(focusedCanvas().getState());
            if (target !== null) {
                focusedCanvas().getState().toggleMaximizedNode(target);
            }
        },
        offered: (moment) => {
            if (!moment.onCanvas || maximizeTargetOf(moment.canvas) === null) {
                return false;
            }

            return maximizedNodeOf(moment.canvas) === null ? true : { label: i18next.t('canvas:node.restore') };
        }
    },
    'note-lock-preview': {
        run: () => {
            const target = maximizeTargetOf(focusedCanvas().getState());
            if (target !== null) {
                setNotePreviewLocked(target, !isNotePreviewLocked(target));
            }
        },
        offered: (moment) => {
            const target = moment.onCanvas ? maximizeTargetOf(moment.canvas) : null;
            const node = target === null ? undefined : moment.canvas.nodes[target];
            if (target === null || node?.kind !== 'note' || (node.body ?? '').trim() === '') {
                return false;
            }

            return isNotePreviewLocked(target) ? { label: i18next.t('canvas:note.unlockPreview') } : true;
        }
    },
    fit: {
        keyTier: 'canvas',
        run: () => fitAction(),
        offered: zoomable,
        key: onCanvasKey(
            () => fitAction(),
            () => fitAction()
        )
    },
    'zoom-selection': {
        keyTier: 'canvas',
        run: () => zoomTarget().zoomToSelection(),
        offered: zoomable,
        key: onCanvasKey(
            () => focusedCanvas().getState().zoomToSelection(),
            () => focusedDiagram().getState().zoomToSelection()
        )
    },
    // A chat in reading focus has a size of its own, which this row resets in place of the camera's.
    'zoom-reset': {
        keyTier: 'canvas',
        run: () => {
            if (!resetChatTextSize()) {
                zoomTarget().zoomTo(1);
            }
        },
        offered: (moment) =>
            moment.inWorkspace && focusedChatTextSize() !== null ? { label: i18next.t('shell:palette.commands.chatTextReset') } : zoomable(moment),
        key: onCanvasKey(
            () => focusedCanvas().getState().zoomTo(1),
            () => focusedDiagram().getState().zoomTo(1)
        )
    },
    'zoom-node': {
        run: () => focusedCanvas().getState().zoomToNode(),
        offered: (moment) => moment.onCanvas && zoomNodeTargetOf(moment.canvas) !== null,
        key: (press) => {
            const canvas = focusedCanvas().getState();
            if (!onStandaloneView() && keyFree(press.event.target) && zoomNodeTargetOf(canvas) !== null) {
                takeKey(press, () => canvas.zoomToNode());
            }

            return true;
        }
    },
    'camera-back': steppingCamera(-1),
    'camera-forward': steppingCamera(1),
    'node-left': selecting('left'),
    'node-right': selecting('right'),
    'node-up': selecting('up'),
    'node-down': selecting('down'),
    'add-terminal': addingNode('terminal'),
    'add-chat': addingNode('chat'),
    'add-browser': addingNode('browser'),
    'add-note': addingNode('note'),
    'add-group': addingNode('group'),
    'add-text': { run: () => createTextAction(), offered: (moment) => moment.onCanvas },
    'add-file': {
        run: () => useUi.getState().openFilePicker({ kind: 'node', at: centerWorld() }),
        offered: (moment) => moment.onCanvas && moment.folder !== null && { hint: i18next.t('shell:palette.hints.readOnly') }
    },
    'group-selection': {
        keyTier: 'canvas',
        run: () => groupSelectionAction(),
        offered: (moment) => moment.onCanvas && (moment.canvas.selection.length === 0 ? { hint: i18next.t('shell:palette.hints.selectFirst') } : true),
        key: onCanvasKey(() => groupSelectionAction())
    },
    'group-arrange': {
        run: () => {
            const { viewId, selection } = focusedCanvas().getState();
            arrangeGroupAction(viewId, selection[0]!);
        },
        offered: (moment) =>
            moment.onCanvas && moment.canvas.selection.length === 1 && groupArrangeable(moment.canvas.nodes[moment.canvas.selection[0]!], moment.canvas.locks)
    },
    'view-promote': {
        run: () => {
            const selected = focusedCanvas().getState();
            const node = selected.selection.length === 1 ? selected.nodes[selected.selection[0]!] : undefined;
            if (node !== undefined) {
                askOpenAsView(node.id);
            }
        },
        offered: (moment) => moment.inWorkspace && moment.selected !== undefined && canOpenAsView(moment.selected.kind) && { hint: moment.selected.title }
    },
    lock: {
        run: () => setLocksAction(!Object.values(focusedCanvas().getState().locks).some(Boolean)),
        offered: (moment) =>
            moment.onCanvas && (Object.values(moment.canvas.locks).some(Boolean) ? { label: i18next.t('shell:palette.commands.unlockAll') } : true)
    },
    'layout-save': {
        run: () => layoutDialog.set(true),
        offered: (moment) => moment.onCanvas && { hint: i18next.t('shell:palette.hints.rememberLayout') }
    }
});

/*
 * Moving a node to another view is one command per target: the palette has no second step, and a project
 * rarely has enough views for that to grow long.
 */
export function nodeMovePaletteRows(moment: CommandMoment): Command[] {
    const { selected } = moment;
    if (!moment.onCanvas || selected === undefined || selected.kind === 'group') {
        return [];
    }
    const { views, activeViewId } = moment.document;

    return views
        .filter((view) => isCanvasView(view) && view.id !== activeViewId)
        .map((view) => ({
            id: `view-move-${view.id}`,
            label: i18next.t('shell:palette.moveNodeTo', { view: view.name }),
            hint: selected.title,
            run: () => moveNodeToViewAction(selected.id, view.id)
        }));
}

/* The saved layouts, each applied or deleted by a row of its own. */
export function layoutPaletteRows(moment: CommandMoment): Command[] {
    if (!moment.onCanvas) {
        return [];
    }

    return moment.canvas.layouts.flatMap((layout): Command[] => [
        {
            id: `layout-apply-${layout.name}`,
            label: i18next.t('shell:palette.applyLayout', { name: layout.name }),
            run: () => applyLayoutAction(layout.name)
        },
        {
            id: `layout-delete-${layout.name}`,
            label: i18next.t('shell:palette.deleteLayout', { name: layout.name }),
            run: () => deleteLayoutAction(layout.name)
        }
    ]);
}

export const CANVAS_GENERATED: readonly GeneratedCommands[] = [
    { prefix: 'view-move-', usage: 'viewMove', palette: true, icon: ArrowRight },
    { prefix: 'layout-apply-', usage: 'layoutApply', palette: true, icon: LayoutDashboard },
    { prefix: 'layout-delete-', usage: 'layoutDelete', palette: true, icon: Trash }
];
