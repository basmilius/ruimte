import { createFocusRegistry } from '@/shell/panels/focus-registry';
import { cellElement } from '@/shell/cell-rects';
import { useDocument } from '@/state/document';
import type { EditorLanguage } from './ruimte-editor-language';

const languages = createFocusRegistry<EditorLanguage>();

/* An editor's language side and the element it draws in, so a command from the palette or the menu finds the editor that has the keyboard. */
export const registerFocusedLanguage = languages.register;
export const subscribeFocusedLanguages = languages.subscribe;

/* Menu availability reads the language target without refocusing its editor. */
export function availableLanguageForCommand(): EditorLanguage | null {
    const focused = languages.focused();

    if (focused !== null) {
        return focused;
    }

    const state = useDocument.getState();
    return state.activeViewId === null ? null : languages.recentIn(cellElement(state.activeViewId));
}

export function languageForCommand(): EditorLanguage | null {
    const language = availableLanguageForCommand();

    if (language !== null && languages.focused() !== language) {
        language.editor.focus();
    }

    return language;
}
