import { isInFloatingLayer } from '@adecore/ui';
import { isCanvasView } from '@ruimte/contracts';
import { cellAt, isTabHost } from '@/layout/split';
import type { CanvasState } from '@/state/canvas';
import { activeViewOf, useDocument } from '@/state/document';
import { useUi } from '@/state/ui';
import { isInNodeBody } from '@/surface/canvas/node-body';
import { isTypingTarget } from '@/surface/canvas/typing-target';

/* The canvas keeps its own keys to itself while a view of its own has the focus; a loose view is one, and is no project view. */
export function onStandaloneView(): boolean {
    const state = useDocument.getState();
    if (state.activeViewId === null) {
        return false;
    }
    const view = activeViewOf(state);

    return view === null || !isCanvasView(view);
}

/* The tab in front of the focused cell when that cell is a tab host, else null. */
export function focusedHostTab(): string | null {
    const { layout } = useDocument.getState();
    const cell = layout === null ? null : cellAt(layout, layout.focus);

    return cell !== null && isTabHost(cell) ? cell.viewId : null;
}

/* What the close key takes: the tab in front of a host, or the loose view that fills its cell alone, which has the same guards. */
export function focusedClosableTab(): string | null {
    const state = useDocument.getState();
    const hosted = focusedHostTab();
    if (hosted !== null) {
        return hosted;
    }

    return state.activeViewId !== null && activeViewOf(state) === null ? state.activeViewId : null;
}

/* A dialog owns the keyboard while it is up; Backspace there must not delete nodes. Nor may a key reach the canvas that is parked behind a view of its own. */
export function keyboardOnCanvas(target: EventTarget | null, canvas: CanvasState): boolean {
    return !(
        isTypingTarget(target) ||
        isInNodeBody(target) ||
        canvas.bodyFocusId !== null ||
        canvas.gesturing ||
        isInFloatingLayer(target) ||
        useUi.getState().settings.open ||
        onStandaloneView()
    );
}

/* A key press that a popup or the settings dialog owns is not the window's. */
export function keyFree(target: EventTarget | null): boolean {
    return !isInFloatingLayer(target) && !useUi.getState().settings.open;
}
