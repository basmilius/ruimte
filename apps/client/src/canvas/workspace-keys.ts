import { isInFloatingLayer } from '@adecore/ui';
import { isCanvasView } from '@ruimte/contracts';
import { createNodeAction, selectAllAction } from '@/action-port/person-actions';
import { answerCanvasPaste } from '@/canvas/canvas-paste';
import { deleteSelectionAsking } from '@/canvas/delete-selection';
import { cancelCanvasGesture } from '@/canvas/gesture-cancel';
import { pointerInWorld } from '@/canvas/pointer';
import type { KeyHandler } from '@/commands/behavior';
import { keyboardOnCanvas } from '@/commands/key-context';
import { isPlainEscape, type WorkspaceKeys } from '@/commands/workspace-keys';
import { focusedCanvas, type CanvasState } from '@/state/canvas';
import { activeViewOf, useDocument } from '@/state/document';
import { setGapModifierDown } from '@/surface/canvas/gap-modifier';
import { isInPromptStack, leavePromptStack } from '@/surface/canvas/prompt-stack';
import { CANVAS_SHORTCUTS } from '@/surface/canvas/shortcuts';
import { followSpaceRelease, holdSpace, releaseSpace, spaceWorksTarget } from '@/surface/canvas/space-pan';
import { isTypingTarget } from '@/surface/canvas/typing-target';
import { transportFor } from '@/transport/index';
import { windowWorkspace } from '@/workspace/window';

function escapeCanvas(canvas: CanvasState): void {
    if (canvas.lineTool !== null) {
        canvas.setLineTool(null);
    } else if (canvas.linkDraft?.aiming) {
        canvas.setLinkDraft(null);
    } else if (canvas.editingTextId) {
        canvas.setEditingText(null);
    } else if (canvas.bodyFocusId === null) {
        canvas.clearSelection();
    }
    /* Escape steps out of the content and leaves the node selected, since a press on its
       header put the keyboard there: the keys that act on a node work again right away. */
    canvas.setBodyFocus(null);
    (document.activeElement as HTMLElement | null)?.blur();
}

/* A paste goes to what has the focus, so one aimed at a row of the sidebar or a panel is not the canvas's either. */
function pasteOnCanvas(target: EventTarget | null): boolean {
    const view = activeViewOf(useDocument.getState());
    if (view === null || !isCanvasView(view)) {
        return false;
    }
    const onSurface = target === document.body || (target instanceof Element && target.closest('[data-canvas-surface]') !== null);

    return onSurface && keyboardOnCanvas(target, focusedCanvas().getState());
}

/* The Alt key held shows the gaps between nodes; it is read on every key, before any other listener can stop it. */
export function gapKeys(): WorkspaceKeys {
    return {
        capture(event) {
            setGapModifierDown(event.altKey);

            return false;
        },
        keyup: (event) => setGapModifierDown(event.altKey),
        blur: () => setGapModifierDown(false),
        dispose: () => setGapModifierDown(false)
    };
}

export function canvasKeys(): WorkspaceKeys {
    const stopSpaceRelease = followSpaceRelease();

    return {
        capture(event) {
            if (!isPlainEscape(event) || isInFloatingLayer(event.target)) {
                return false;
            }
            if (cancelCanvasGesture(focusedCanvas())) {
                event.preventDefault();
                event.stopImmediatePropagation();

                return true;
            }
            // A card of a prompt stack hands the keyboard back, before a chat or a node behind it hears the key.
            if (isInPromptStack(event.target)) {
                event.preventDefault();
                event.stopPropagation();
                leavePromptStack();

                return true;
            }

            return false;
        },
        keydown(event) {
            if (event.code === 'Space' && !isTypingTarget(event.target) && !spaceWorksTarget(event.target)) {
                holdSpace();
                event.preventDefault();

                return true;
            }
            if (event.key !== 'Escape') {
                return false;
            }
            // An open popup or dialog owns Escape. It closes itself, and the node it belongs to stays focused.
            if (!isInFloatingLayer(event.target)) {
                escapeCanvas(focusedCanvas().getState());
            }

            return true;
        },
        keyup(event) {
            if (event.code === 'Space') {
                releaseSpace();
            }
        },
        paste(event) {
            answerCanvasPaste(event, {
                onCanvas: pasteOnCanvas,
                pointer: () => pointerInWorld(focusedCanvas()),
                createNote: (content, at) => {
                    void createNodeAction('note', { content, ...(at === null ? {} : { at }) });
                }
            });
        },
        dispose: stopSpaceRelease
    };
}

/* The keys of the canvas under the keyboard that belong to no row: Enter into a node, Delete, select all and the zoom steps. */
export const CANVAS_KEY_HANDLERS: readonly KeyHandler[] = [
    (press) => {
        const canvas = focusedCanvas().getState();
        const event = press.event;
        if (!keyboardOnCanvas(event.target, canvas)) {
            return false;
        }
        const plainEnter = event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
        // A card beside a node the keys stand on, which is never selected: Enter goes into it as a press does.
        if (plainEnter && canvas.selection.length === 0 && canvas.navigationId !== null && canvas.derivedCards[canvas.navigationId] !== undefined) {
            event.preventDefault();
            canvas.focusCard(canvas.navigationId);

            return true;
        }
        if (plainEnter && canvas.selection.length === 1) {
            const node = canvas.nodes[canvas.selection[0]!];
            if (node !== undefined && node.kind !== 'group' && !canvas.hidden.has(node.id)) {
                event.preventDefault();
                canvas.activateNode(node.id);
            }

            return true;
        }
        if (press.is(CANVAS_SHORTCUTS.selectAll)) {
            event.preventDefault();
            selectAllAction(focusedCanvas());

            return true;
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && canvas.selection.length > 0) {
            event.preventDefault();
            const endpointId = windowWorkspace()?.connection.endpointId ?? null;
            void deleteSelectionAsking(focusedCanvas(), endpointId === null ? null : transportFor(endpointId));

            return true;
        }
        if (event.key === '=' || event.key === '+') {
            canvas.zoomTo(Math.round(canvas.camera.zoom * 100 + 10) / 100);

            return true;
        }
        if (event.key === '-') {
            canvas.zoomTo(Math.round(canvas.camera.zoom * 100 - 10) / 100);

            return true;
        }

        return false;
    }
];
