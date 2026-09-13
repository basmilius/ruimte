import { useEffect } from 'react';
import { isCanvasView } from '@ruimte/contracts';
import { addNodeAtCenter } from '@/shell/commands';
import { newCanvasView, showView, splitFocusedCell, stepView, viewAtIndex } from '@/project/views';
import { useCanvas, type NodeKind } from '@/state/canvas';
import { activeViewOf, useDocument } from '@/state/document';
import { useUi } from '@/state/ui';
import { cellCount, type SplitDirection } from '@/shell/split';
import { isFocusedWorkspace, type WorkspaceStores } from '@/state/workspace-stores';
import { isInFloatingLayer } from '@/ui/floating';

/* The four directions, as the physical keys, so a layout that moves the arrows still reads them. */
const ARROWS: Record<string, SplitDirection> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

// Option plus a letter adds a node; a bare letter would fight every text field on the canvas.
const ADD_KEYS: Record<string, NodeKind> = { KeyT: 'terminal', KeyC: 'chat', KeyB: 'browser', KeyG: 'group', KeyN: 'note' };

/* The canvas keeps its own keys to itself while a view of its own has the focus. */
const onStandaloneView = (): boolean => {
    const view = activeViewOf(useDocument.getState());
    return view !== null && !isCanvasView(view);
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

/*
 * Every chord that acts on a project: the views it switches between, the nodes it adds and deletes,
 * the panel beside it. Bound on the window once per workspace, because a view has to answer with the
 * keyboard in the sidebar as well, and `isFocusedWorkspace` is what keeps it off the project in the
 * pane beside it. The chords of the window itself (the palette, find in files, the settings, the
 * sidebar) are not here at all: `shell/app-chords.ts` has them.
 *
 * It hangs on the workspace and not on a canvas because a grid draws up to nine of them: nine
 * listeners would each act on the focused cell, so one chord would land nine times. What "the canvas
 * in front of me" means is `useCanvas` on its own, which is the focused cell by definition.
 */
export const useCanvasChords = (stores: WorkspaceStores | null): void => {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent): void => {
            if (!isFocusedWorkspace(stores)) {
                return;
            }
            const s = useCanvas.getState();
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
                } else if (s.mode.kind === 'node') {
                    s.exitNode();
                } else {
                    s.clearSelection();
                }
                (document.activeElement as HTMLElement | null)?.blur();
                return;
            }
            const mod = e.metaKey || e.ctrlKey;
            /* The grid answers from anywhere, a focused node or a text field included: splitting,
               closing and stepping between cells are about the window, not about what is in a cell. */
            if (mod && e.code === 'Backslash' && !e.altKey) {
                e.preventDefault();
                splitFocusedCell(e.shiftKey ? 'down' : 'right');
                return;
            }
            if (mod && e.altKey && ARROWS[e.code]) {
                e.preventDefault();
                useDocument.getState().focusTowards(ARROWS[e.code]!);
                return;
            }
            /* The preview closes its own tab on ⌘W and says so by stopping the event; only with the
               keyboard outside it does the chord reach the cell. */
            if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyW' && !e.defaultPrevented) {
                const layout = useDocument.getState().layout;
                if (layout !== null && cellCount(layout) > 1) {
                    e.preventDefault();
                    useDocument.getState().closeCellAt(layout.focus);
                }
                return;
            }
            // The views answer from anywhere, a focused node included: they are how you leave one.
            if (mod && !e.altKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
                e.preventDefault();
                const view = viewAtIndex(Number(e.code.slice(-1)));
                if (view) {
                    showView(view.id);
                }
                return;
            }
            if (mod && e.shiftKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
                e.preventDefault();
                stepView(e.code === 'BracketRight' ? 1 : -1);
                return;
            }
            if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyT') {
                e.preventDefault();
                newCanvasView();
                return;
            }
            // Option+B on macOS is a dead key, so the chord reads the physical key, not the character.
            if (mod && e.altKey && e.code === 'KeyB') {
                e.preventDefault();
                useUi.getState().togglePanel();
                return;
            }
            // A dialog owns the keyboard while it is up; Backspace there must not delete nodes. Nor may
            // a key reach the canvas that is parked behind a view of its own.
            if (isTypingTarget(e.target) || s.mode.kind === 'node' || useUi.getState().settings.open || onStandaloneView()) {
                return;
            }
            if (e.altKey && !mod && ADD_KEYS[e.code]) {
                e.preventDefault();
                addNodeAtCenter(ADD_KEYS[e.code]!);
            } else if (mod && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    s.redo();
                } else {
                    s.undo();
                }
            } else if (mod && e.key === 'g') {
                e.preventDefault();
                s.groupSelection();
            } else if (mod && e.code === 'Digit0') {
                e.preventDefault();
                s.zoomTo(1);
            } else if (e.shiftKey && e.code === 'Digit1') {
                e.preventDefault();
                s.fitAll();
            } else if (e.shiftKey && e.code === 'Digit2') {
                e.preventDefault();
                s.zoomToSelection();
            } else if (mod && e.key === 'a') {
                e.preventDefault();
                s.select([...s.order, ...Object.keys(s.texts)]);
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection.length > 0) {
                e.preventDefault();
                s.deleteSelected();
            } else if (e.key === '=' || e.key === '+') {
                s.zoomTo(Math.round(s.camera.zoom * 100 + 10) / 100);
            } else if (e.key === '-') {
                s.zoomTo(Math.round(s.camera.zoom * 100 - 10) / 100);
            }
        };
        const onKeyUp = (e: KeyboardEvent): void => {
            if (e.code === 'Space') {
                spaceDown = false;
            }
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, [stores]);
};
