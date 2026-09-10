import { useEffect } from 'react';
import { GRID } from '@/canvas/math';
import { copyDrawingElements, readDrawingElements } from '@/drawing/export';
import { useDrawing, type DrawingTool } from '@/state/drawing';
import { useUi } from '@/state/ui';
import { isInFloatingLayer } from '@/ui/floating';

/*
 * The one place in the app where a bare letter is a chord. A drawing has the keyboard the way a
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
const clearOne = (): boolean => {
    const state = useDrawing.getState();
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

/* True while the drawing still has something to let go of, which is what keeps Escape here. */
export const drawingCanClear = (): boolean => {
    const state = useDrawing.getState();
    return state.draft !== null || state.editingTextId !== null || state.selection.length > 0 || state.tool !== 'select';
};

export const useDrawingKeys = (active: boolean): void => {
    useEffect(() => {
        if (!active) {
            return;
        }
        const onKeyDown = (e: KeyboardEvent): void => {
            if (somethingElseHasIt(e.target)) {
                return;
            }
            const state = useDrawing.getState();
            const mod = e.metaKey || e.ctrlKey;
            if (e.key === 'Escape' && !mod) {
                if (clearOne()) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                return;
            }
            if (mod) {
                const key = e.key.toLowerCase();
                if (key === 'z') {
                    e.preventDefault();
                    if (e.shiftKey) {
                        state.redo();
                    } else {
                        state.undo();
                    }
                    return;
                }
                if (key === 'a') {
                    e.preventDefault();
                    state.selectAll();
                    return;
                }
                if (key === 'd') {
                    e.preventDefault();
                    state.duplicateSelected();
                    return;
                }
                if (key === 'l' && e.shiftKey) {
                    e.preventDefault();
                    state.toggleLockSelected();
                    return;
                }
                if (key === 'c') {
                    e.preventDefault();
                    void copyDrawingElements();
                    return;
                }
                if (key === 'x') {
                    e.preventDefault();
                    void copyDrawingElements().then(() => useDrawing.getState().deleteSelected());
                    return;
                }
                if (key === 'v') {
                    e.preventDefault();
                    void navigator.clipboard.readText().then((text) => {
                        const elements = readDrawingElements(text);
                        if (elements) {
                            useDrawing.getState().pasteElements(elements);
                        }
                    });
                    return;
                }
                if (key === ']') {
                    e.preventDefault();
                    state.bringToFront();
                    return;
                }
                if (key === '[') {
                    e.preventDefault();
                    state.sendToBack();
                    return;
                }
                if (key === '0') {
                    e.preventDefault();
                    state.zoomTo(1);
                }
                return;
            }
            if (e.altKey) {
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                state.deleteSelected();
                return;
            }
            if (e.key.startsWith('Arrow')) {
                e.preventDefault();
                const step = e.shiftKey ? GRID : 1;
                const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
                const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
                state.moveSelected(dx, dy);
                return;
            }
            if (e.shiftKey) {
                if (e.code === 'Digit1') {
                    e.preventDefault();
                    state.fitAll();
                    return;
                }
                if (e.code === 'Digit2') {
                    e.preventDefault();
                    state.zoomToSelection();
                }
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
    }, [active]);
};
