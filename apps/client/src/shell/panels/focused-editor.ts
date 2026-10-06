import type { Editor } from '@adecore/editor';

interface Entry {
    editor: Editor;
    surface: HTMLElement;
}

const entries = new Set<Entry>();

/* An editor and the element it draws in, so a command from the palette or the menu finds the editor that has the keyboard. */
export function registerFocusedEditor(editor: Editor, surface: HTMLElement): () => void {
    const entry = { editor, surface };
    entries.add(entry);
    return () => {
        entries.delete(entry);
    };
}

/* The editor the keyboard is in, or null when it is anywhere else. The innermost wins when one sits inside another's surface. */
export function focusedEditor(): Editor | null {
    const active = document.activeElement;
    if (active === null) {
        return null;
    }
    let found: Entry | null = null;
    for (const entry of entries) {
        if (entry.surface.contains(active) && (found === null || found.surface.contains(entry.surface))) {
            found = entry;
        }
    }
    return found?.editor ?? null;
}
