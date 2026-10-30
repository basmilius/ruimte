import type { Editor } from '@adecore/editor';
import { cellElement } from '@/shell/cell-rects';
import { useDocument } from '@/state/document';
import { createFocusRegistry } from './focus-registry';

const editors = createFocusRegistry<Editor>();

/* An editor and the element it draws in, so a command from the palette or the menu finds the editor that has the keyboard. */
export const registerFocusedEditor = editors.register;

export const focusedEditor = editors.focused;

export const recentEditorIn = editors.recentIn;
export const subscribeFocusedEditors = editors.subscribe;

/* Menu availability must read the same target without taking the keyboard from its menu. */
export function availableEditorForCommand(): Editor | null {
    const focused = focusedEditor();

    if (focused !== null) {
        return focused;
    }

    const state = useDocument.getState();
    return state.activeViewId === null ? null : recentEditorIn(cellElement(state.activeViewId));
}

export function editorForCommand(): Editor | null {
    const editor = availableEditorForCommand();

    if (editor !== null && focusedEditor() !== editor) {
        editor.focus();
    }

    return editor;
}

/* The active view's last focused editor, when `surface` belongs to that view. */
export function activeViewEditorFor(surface: Element): Editor | null {
    const state = useDocument.getState();
    const cell = state.activeViewId === null ? null : cellElement(state.activeViewId);

    return cell !== null && cell.contains(surface) ? recentEditorIn(cell) : null;
}
