import { useEffect } from 'react';
import type { StoreApi } from 'zustand';
import { fitAction, historyAction } from '@/actions/client-actions';
import { GRID } from '@/canvas/math';
import { isApplePlatform } from '@/desktop/bridge';
import { DRAWING_SHORTCUTS } from '@/drawing/shortcuts';
import {
    copyDrawing,
    cutSelection,
    deleteSelection,
    duplicateSelection,
    moveSelection,
    pasteInto,
    reorderSelection,
    toggleLockSelection
} from '@/drawing/drawing-actions';
import type { DrawingState, DrawingTool } from '@/state/drawing';
import { useUi } from '@/state/ui';
import { matchesShortcut, type Shortcut } from '@/ui/shortcut';
import { isInFloatingLayer } from '@/ui/floating';

/*
 * The one place in the app where a bare letter is a shortcut. A drawing has the keyboard the way a
 * terminal has it, and these are the letters every sketching tool uses; they never fire while a
 * text is being typed or a dialog is up.
 */
const TOOL_KEYS: Record<string, DrawingTool> = {
    v: 'select',
    '1': 'select',
    h: 'hand',
    r: 'rect',
    '2': 'rect',
    d: 'diamond',
    '3': 'diamond',
    o: 'ellipse',
    '4': 'ellipse',
    a: 'arrow',
    '5': 'arrow',
    l: 'line',
    '6': 'line',
    p: 'freehand',
    '7': 'freehand',
    t: 'text',
    '8': 'text',
    n: 'note',
    '9': 'note',
    e: 'eraser',
    '0': 'eraser'
};

const isTypingTarget = (el: EventTarget | null): boolean =>
    el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

/* Whether anything else on screen has a claim on the keyboard right now. */
const somethingElseHasIt = (target: EventTarget | null): boolean => {
    const ui = useUi.getState();
    return isTypingTarget(target) || isInFloatingLayer(target) || ui.settings.open || ui.paletteOpen || ui.viewDialog !== null || ui.layoutDialogOpen;
};

/* Escape clears one thing at a time, in the order the canvas uses: the draft first, the tool last. */
const clearOne = (store: StoreApi<DrawingState>): boolean => {
    const state = store.getState();
    if (state.draft) {
        state.cancelDraft();
        return true;
    }
    if (state.editingTextId) {
        state.setEditingText(null);
        return true;
    }
    if (state.selection.length > 0) {
        state.clearSelection();
        return true;
    }
    if (state.tool !== 'select') {
        state.setTool('select');
        return true;
    }
    return false;
};

/* The tools of the drawing in one cell. The store is the cell's own, never the focused one: the
   listener sits on the window, so the drawing it acts on has to be decided where it is drawn. */
export const useDrawingKeys = (store: StoreApi<DrawingState>, active: boolean): void => {
    useEffect(() => {
        if (!active) {
            return;
        }
        const onKeyDown = (e: KeyboardEvent): void => {
            if (somethingElseHasIt(e.target)) {
                return;
            }
            const state = store.getState();
            const apple = isApplePlatform();
            const is = (target: Shortcut): boolean => matchesShortcut(target, e, apple);
            const mod = e.metaKey || e.ctrlKey;
            if (e.key === 'Escape' && !mod) {
                if (clearOne(store)) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                return;
            }
            if (is(DRAWING_SHORTCUTS.undo) || is(DRAWING_SHORTCUTS.redo)) {
                e.preventDefault();
                historyAction(is(DRAWING_SHORTCUTS.redo) ? 'redo' : 'undo', state.viewId);
                return;
            }
            if (is(DRAWING_SHORTCUTS.selectAll)) {
                e.preventDefault();
                state.selectAll();
                return;
            }
            if (is(DRAWING_SHORTCUTS.duplicate)) {
                e.preventDefault();
                duplicateSelection(store);
                return;
            }
            if (is(DRAWING_SHORTCUTS.lock)) {
                e.preventDefault();
                toggleLockSelection(store);
                return;
            }
            if (is(DRAWING_SHORTCUTS.copy)) {
                e.preventDefault();
                void copyDrawing(store, 'elements');
                return;
            }
            if (is(DRAWING_SHORTCUTS.cut)) {
                e.preventDefault();
                void cutSelection(store);
                return;
            }
            if (is(DRAWING_SHORTCUTS.paste)) {
                e.preventDefault();
                void pasteInto(store);
                return;
            }
            if (is(DRAWING_SHORTCUTS.bringToFront)) {
                e.preventDefault();
                reorderSelection(store, 'front');
                return;
            }
            if (is(DRAWING_SHORTCUTS.sendToBack)) {
                e.preventDefault();
                reorderSelection(store, 'back');
                return;
            }
            if (is(DRAWING_SHORTCUTS.zoomReset)) {
                e.preventDefault();
                state.zoomTo(1);
                return;
            }
            if (is(DRAWING_SHORTCUTS.fitAll)) {
                e.preventDefault();
                fitAction(state.viewId);
                return;
            }
            if (is(DRAWING_SHORTCUTS.zoomSelection)) {
                e.preventDefault();
                state.zoomToSelection();
                return;
            }
            // A held Cmd or Ctrl is never a bare letter, or Ctrl+V on macOS would pick the select tool.
            if (mod) {
                return;
            }
            if (e.altKey) {
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                void deleteSelection(store);
                return;
            }
            if (e.key.startsWith('Arrow')) {
                e.preventDefault();
                const step = e.shiftKey ? GRID : 1;
                const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
                const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
                moveSelection(store, dx, dy);
                return;
            }
            if (e.shiftKey) {
                return;
            }
            if (e.key === '=' || e.key === '+') {
                e.preventDefault();
                state.zoomTo(Math.round(state.camera.zoom * 100 + 10) / 100);
                return;
            }
            if (e.key === '-') {
                e.preventDefault();
                state.zoomTo(Math.round(state.camera.zoom * 100 - 10) / 100);
                return;
            }
            if (e.key.toLowerCase() === 'q') {
                e.preventDefault();
                state.toggleToolLock();
                return;
            }
            const tool = TOOL_KEYS[e.key.toLowerCase()];
            if (tool) {
                e.preventDefault();
                state.setTool(tool);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [active, store]);
};
