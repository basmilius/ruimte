import { useEffect } from 'react';
import { isCanvasView, isDiagramView } from '@ruimte/contracts';
import { browserRegistry } from '@/browser/registry';
import { ADD_NODE_SHORTCUTS, CANVAS_SHORTCUTS, FOCUS_SHORTCUTS, VIEW_SHORTCUTS } from '@/canvas/shortcuts';
import { isApplePlatform } from '@/desktop/bridge';
import { addNodeAtCenter } from '@/shell/commands';
import { newCanvasView, showView, splitFocusedCell, stepView, viewAtIndex } from '@/project/views';
import { deleteSelectionAsking } from '@/canvas/delete-selection';
import { isInNodeBody } from '@/canvas/node-body';
import { focusPromptStack, isInPromptStack, leavePromptStack } from '@/canvas/prompt-stack';
import { useSubagentView } from '@/chat/subagent-view';
import { stepTimelineMessage } from '@/chat/timeline-scroll';
import { focusedCanvas } from '@/state/canvas';
import { transportFor } from '@/transport';
import { focusedDiagram } from '@/state/diagram';
import { activeViewOf, useDocument } from '@/state/document';
import { useUi } from '@/state/ui';
import { cellCount, type SplitDirection } from '@/shell/split';
import { matchesShortcut, type Shortcut } from '@/ui/shortcut';
import { endpointKey } from '@/state/keys';
import { windowWorkspace } from '@/state/window';
import { isInFloatingLayer } from '@/ui/floating';

const workspaceEndpointId = (): string | null => windowWorkspace()?.connection.endpointId ?? null;

/* The first entry whose shortcut the event is, so a table reads as one condition. */
const entryFor = <T extends string>(table: Record<T, Shortcut>, e: KeyboardEvent, apple: boolean): T | null =>
    (Object.keys(table) as T[]).find((name) => matchesShortcut(table[name], e, apple)) ?? null;

/* The canvas keeps its own keys to itself while a view of its own has the focus. */
const onStandaloneView = (): boolean => {
    const view = activeViewOf(useDocument.getState());
    return view !== null && !isCanvasView(view);
};

/* The page the keyboard means: a browser view in the focused cell, or the active browser node on its canvas. */
const focusedBrowserKey = (): string | null => {
    const endpointId = workspaceEndpointId();
    const view = activeViewOf(useDocument.getState());
    if (endpointId === null || view === null) {
        return null;
    }
    if (!isCanvasView(view)) {
        return view.kind === 'browser' ? endpointKey(endpointId, view.id) : null;
    }
    const { bodyFocusId, nodes } = focusedCanvas().getState();
    return bodyFocusId !== null && nodes[bodyFocusId]?.kind === 'browser' ? endpointKey(endpointId, bodyFocusId) : null;
};

/* The chat the keyboard is in: a chat view whose body has it, or the active chat node on its canvas. */
const focusedChatKey = (): string | null => {
    const endpointId = workspaceEndpointId();
    const documentState = useDocument.getState();
    const view = activeViewOf(documentState);
    if (endpointId === null || view === null) {
        return null;
    }
    if (!isCanvasView(view)) {
        return view.kind === 'chat' && documentState.bodyFocused ? endpointKey(endpointId, view.id) : null;
    }
    const { bodyFocusId, nodes } = focusedCanvas().getState();
    return bodyFocusId !== null && nodes[bodyFocusId]?.kind === 'chat' ? endpointKey(endpointId, bodyFocusId) : null;
};

export const isTypingTarget = (el: EventTarget | null): boolean => {
    if (!(el instanceof HTMLElement)) {
        return false;
    }
    return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
};

/*
 * Space turns the pointer into a pan. There is one keyboard, so this is one flag for the window
 * rather than a ref per cell: the canvas the pointer goes down in is the one that pans, and which
 * one that is, is a question the pointer answers and not the key.
 */
let spaceDown = false;

export const isSpaceDown = (): boolean => spaceDown;

/* Bind once per workspace so a split grid does not run the same project shortcut in every canvas. */
export const useCanvasShortcuts = (): void => {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent): void => {
            const s = focusedCanvas().getState();
            if (e.code === 'Space' && !isTypingTarget(e.target)) {
                spaceDown = true;
                e.preventDefault();
                return;
            }
            if (e.key === 'Escape') {
                // An open popup or dialog owns Escape. It closes itself, and the node it belongs to stays focused.
                if (isInFloatingLayer(e.target)) {
                    return;
                }
                // The view host answers Escape for a view of its own; there is no canvas to return to.
                if (onStandaloneView()) {
                    return;
                }
                if (s.linkDraft?.aiming) {
                    s.setLinkDraft(null);
                } else if (s.editingTextId) {
                    s.setEditingText(null);
                } else if (s.bodyFocusId === null) {
                    s.clearSelection();
                }
                /* Escape steps out of the content and leaves the node selected, since a press on its
                   header put the keyboard there: the keys that act on a node work again right away. */
                s.setBodyFocus(null);
                (document.activeElement as HTMLElement | null)?.blur();
                return;
            }
            const apple = isApplePlatform();
            const is = (target: Shortcut): boolean => matchesShortcut(target, e, apple);
            /* The grid answers from anywhere, a focused node or a text field included: splitting,
               closing and stepping between cells are about the window, not about what is in a cell. */
            if (is(CANVAS_SHORTCUTS.splitRight) || is(CANVAS_SHORTCUTS.splitDown)) {
                e.preventDefault();
                splitFocusedCell(is(CANVAS_SHORTCUTS.splitDown) ? 'down' : 'right');
                return;
            }
            const direction: SplitDirection | null = entryFor(FOCUS_SHORTCUTS, e, apple);
            if (direction) {
                e.preventDefault();
                useDocument.getState().focusTowards(direction);
                return;
            }
            /* The preview closes its own tab on this shortcut and says so by stopping the event; only with
               the keyboard outside it does the shortcut reach the cell. Off macOS the window menu's Close
               answers Ctrl+W, so the shortcut is always taken there, even with nothing to close. */
            if (is(CANVAS_SHORTCUTS.closeCell)) {
                const layout = useDocument.getState().layout;
                const closes = !e.defaultPrevented && layout !== null && cellCount(layout) > 1;
                if (closes || !apple) {
                    e.preventDefault();
                }
                if (closes && layout !== null) {
                    useDocument.getState().closeCellAt(layout.focus);
                }
                return;
            }
            // The views answer from anywhere, a focused node included: they are how you leave one.
            const viewIndex = VIEW_SHORTCUTS.findIndex((candidate) => is(candidate));
            if (viewIndex !== -1) {
                e.preventDefault();
                const view = viewAtIndex(viewIndex + 1);
                if (view) {
                    showView(view.id);
                }
                return;
            }
            /* With the keyboard inside the page these never get here; the guest preload sends them instead.
               Only a focused browser takes them, so a drawing keeps them for its order. */
            if (is(CANVAS_SHORTCUTS.browserBack) || is(CANVAS_SHORTCUTS.browserForward)) {
                const key = focusedBrowserKey();
                if (key !== null) {
                    e.preventDefault();
                    if (is(CANVAS_SHORTCUTS.browserForward)) {
                        browserRegistry.forward(key);
                    } else {
                        browserRegistry.back(key);
                    }
                    return;
                }
            }
            /* The composer leaves these keys alone (its keymap is the standard one, without moving lines), so
               they work while typing. Nothing is taken when the chat has no message that way. */
            if (is(CANVAS_SHORTCUTS.previousMessage) || is(CANVAS_SHORTCUTS.nextMessage)) {
                const key = focusedChatKey();
                if (key !== null && !isInFloatingLayer(e.target) && stepTimelineMessage(key, is(CANVAS_SHORTCUTS.nextMessage) ? 1 : -1)) {
                    e.preventDefault();
                    return;
                }
            }
            if (is(CANVAS_SHORTCUTS.previousView) || is(CANVAS_SHORTCUTS.nextView)) {
                e.preventDefault();
                stepView(is(CANVAS_SHORTCUTS.nextView) ? 1 : -1);
                return;
            }
            if (is(CANVAS_SHORTCUTS.newView)) {
                e.preventDefault();
                newCanvasView();
                return;
            }
            // From anywhere, a terminal included: the point is to answer without first leaving what you type in.
            if (is(CANVAS_SHORTCUTS.focusPrompts)) {
                if (focusPromptStack()) {
                    e.preventDefault();
                }
                return;
            }
            if (is(CANVAS_SHORTCUTS.togglePanel)) {
                e.preventDefault();
                useUi.getState().togglePanel();
                return;
            }
            /* A diagram has an undo of its own and nothing else a key reaches; a drawing binds its keys
               in its view, since a drawing has the keyboard the way a terminal has it. */
            const active = activeViewOf(useDocument.getState());
            if (active !== null && isDiagramView(active) && (is(CANVAS_SHORTCUTS.undo) || is(CANVAS_SHORTCUTS.redo))) {
                if (isTypingTarget(e.target) || isInFloatingLayer(e.target) || useUi.getState().settings.open) {
                    return;
                }
                e.preventDefault();
                if (is(CANVAS_SHORTCUTS.redo)) {
                    focusedDiagram().getState().redo();
                } else {
                    focusedDiagram().getState().undo();
                }
                return;
            }
            // A dialog owns the keyboard while it is up; Backspace there must not delete nodes. Nor may
            // a key reach the canvas that is parked behind a view of its own.
            if (isTypingTarget(e.target) || isInNodeBody(e.target) || useUi.getState().settings.open || onStandaloneView()) {
                return;
            }
            const addKind = entryFor(ADD_NODE_SHORTCUTS, e, apple);
            if (addKind) {
                e.preventDefault();
                addNodeAtCenter(addKind);
            } else if (is(CANVAS_SHORTCUTS.undo) || is(CANVAS_SHORTCUTS.redo)) {
                e.preventDefault();
                if (is(CANVAS_SHORTCUTS.redo)) {
                    s.redo();
                } else {
                    s.undo();
                }
            } else if (is(CANVAS_SHORTCUTS.group)) {
                e.preventDefault();
                s.groupSelection();
            } else if (is(CANVAS_SHORTCUTS.zoomReset)) {
                e.preventDefault();
                s.zoomTo(1);
            } else if (is(CANVAS_SHORTCUTS.fitAll)) {
                e.preventDefault();
                s.fitAll();
            } else if (is(CANVAS_SHORTCUTS.zoomSelection)) {
                e.preventDefault();
                s.zoomToSelection();
            } else if (is(CANVAS_SHORTCUTS.selectAll)) {
                e.preventDefault();
                s.select([...s.order, ...Object.keys(s.texts)]);
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection.length > 0) {
                e.preventDefault();
                const endpointId = workspaceEndpointId();
                void deleteSelectionAsking(focusedCanvas(), endpointId === null ? null : transportFor(endpointId));
            } else if (e.key === '=' || e.key === '+') {
                s.zoomTo(Math.round(s.camera.zoom * 100 + 10) / 100);
            } else if (e.key === '-') {
                s.zoomTo(Math.round(s.camera.zoom * 100 - 10) / 100);
            }
        };
        /*
         * Escape in a chat that shows a sub-agent goes one level back up before it does anything else,
         * the way a drawing clears its selection before it lets go of the keyboard. It listens in the
         * capture phase, because leaving the node (below) and leaving a view of its own (`ViewHost`) both
         * listen on the window too, and only stopping the key here keeps them from also acting on it.
         */
        const onEscapeCapture = (e: KeyboardEvent): void => {
            if (e.key !== 'Escape' || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) {
                return;
            }
            if (isInFloatingLayer(e.target)) {
                return;
            }
            // A card of a prompt stack hands the keyboard back, before a chat or a node behind it hears the key.
            if (isInPromptStack(e.target)) {
                e.preventDefault();
                e.stopPropagation();
                leavePromptStack();
                return;
            }
            if (isTypingTarget(e.target)) {
                return;
            }
            const key = focusedChatKey();
            if (key !== null && useSubagentView.getState().back(key)) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        const onKeyUp = (e: KeyboardEvent): void => {
            if (e.code === 'Space') {
                spaceDown = false;
            }
        };
        window.addEventListener('keydown', onEscapeCapture, true);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onEscapeCapture, true);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, []);
};
