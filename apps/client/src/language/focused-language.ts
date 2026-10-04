import type { EditorLanguage } from './editor-language';

interface Entry {
    language: EditorLanguage;
    surface: HTMLElement;
}

const entries = new Set<Entry>();

/* An editor's language side and the element it draws in, so a command from the palette or the menu finds the editor that has the keyboard. */
export function registerFocusedLanguage(language: EditorLanguage, surface: HTMLElement): () => void {
    const entry = { language, surface };
    entries.add(entry);
    return () => {
        entries.delete(entry);
    };
}

/* The language side of the editor the keyboard is in, or null when it is anywhere else. */
export function focusedLanguage(): EditorLanguage | null {
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
    return found?.language ?? null;
}
