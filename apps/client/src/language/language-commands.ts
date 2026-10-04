import i18next from 'i18next';
import type { Shortcut } from '@basmilius/desktop-ui';
import { LANGUAGE_COMMANDS, LANGUAGE_COMMAND_IDS, type LanguageCommandId } from './command-table';
import type { EditorLanguage } from './editor-language';
import { focusedLanguage } from './focused-language';

const RUNNERS: Record<LanguageCommandId, (language: EditorLanguage) => void> = {
    'trigger-completion': (language) => language.completion.invoke(),
    'parameter-info': (language) => language.signature.invoke(),
    'quick-info': (language) => language.hover.quickInfo(),
    'history-back': (language) => void language.history.back(),
    'history-forward': (language) => void language.history.forward(),
    'recent-locations': (language) => language.history.recent(),
    'peek-definition': (language) => void language.peek.openDefinition(),
    'code-actions': (language) => void language.codeActions.open(),
    'rename-symbol': (language) => void language.rename.start(),
    'go-to-symbol': (language) => void language.symbolPicker.open(),
    'go-to-definition': (language) => void language.navigation.go('definition'),
    'go-to-declaration': (language) => void language.navigation.go('declaration'),
    'go-to-type-definition': (language) => void language.navigation.go('typeDefinition'),
    'go-to-implementation': (language) => void language.navigation.go('implementation'),
    'peek-references': (language) => void language.peek.open(),
    'organize-imports': (language) => void language.codeActions.organizeImports(),
    'format-document': (language) => void language.codeActions.formatDocument()
};

export interface LanguageCommandRow {
    id: string;
    label: string;
    shortcut?: Shortcut;
    run(): void;
}

/* The palette's rows for the language commands. They run after the palette has handed the focus back, which is what says which editor is meant. */
export function languageCommandRows(): LanguageCommandRow[] {
    return LANGUAGE_COMMAND_IDS.map((id) => ({
        id,
        label: i18next.t(`shell:palette.commands.${LANGUAGE_COMMANDS[id].key}`),
        shortcut: LANGUAGE_COMMANDS[id].shortcut,
        run: () => {
            requestAnimationFrame(() => {
                const language = focusedLanguage();
                if (language !== null) {
                    RUNNERS[id](language);
                }
            });
        }
    }));
}
