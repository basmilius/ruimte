import type { Shortcut } from '@adecore/ui';
import i18next from 'i18next';
import { agentReviewOf } from '@/language/agent-review-registry';
import { LANGUAGE_COMMANDS, LANGUAGE_COMMAND_IDS, type LanguageCommandId } from './command-table';
import { languageForCommand } from './focused-language';
import type { EditorLanguage } from './ruimte-editor-language';

const RUNNERS: Record<LanguageCommandId, (language: EditorLanguage) => void> = {
    'trigger-completion': (language) => language.completion.invoke(),
    'parameter-info': (language) => language.signature.invoke(),
    'quick-info': (language) => language.hover.quickInfo(),
    'history-back': (language) => void language.history.back(),
    'history-forward': (language) => void language.history.forward(),
    'recent-locations': (language) => language.history.recent(),
    'peek-definition': (language) => void language.peek.openDefinition(),
    'code-actions': (language) => void language.codeActions.open(),
    'refactor-this': (language) => void language.codeActions.refactorThis(),
    'rename-symbol': (language) => void language.rename.start(),
    'go-to-symbol': (language) => void language.symbolPicker.open(),
    'go-to-definition': (language) => void language.navigation.go('definition'),
    'go-to-declaration': (language) => void language.navigation.go('declaration'),
    'go-to-type-definition': (language) => void language.navigation.go('typeDefinition'),
    'go-to-implementation': (language) => void language.navigation.go('implementation'),
    'call-hierarchy': (language) => void language.callHierarchy.open(),
    'peek-references': (language) => void language.peek.open(),
    'organize-imports': (language) => void language.codeActions.organizeImports(),
    'format-document': (language) => void language.codeActions.formatDocument(),
    'next-agent-change': (language) => agentReviewOf(language.editor)?.step(1),
    'previous-agent-change': (language) => agentReviewOf(language.editor)?.step(-1),
    'selection-to-chat': (language) => language.app.selectionChat.choose(),
    'inline-edit': (language) => language.app.inlineEdit.start(),
    'show-inline-edit': (language) => void language.app.inlineEdit.show(),
    explain: (language) => void language.app.explain.explainHere(),
    'toggle-rendered-docs': (language) => void language.renderedDocs.toggle(),
    'suggest-inline': (language) => void language.app.ghost.request(),
    'type-hierarchy': (language) => void language.callHierarchy.open(undefined, 'supertypes'),
    'last-edit-location': (language) => void language.history.lastEdit(),
    'next-edit-location': (language) => void language.history.nextEdit(),
    'paste-from-history': (language) => language.pasteHistory.open(),
    'wrap-with-abbreviation': (language) => language.markup.startWrap(),
    'insert-live-template': (language) => language.templates.insert(),
    'surround-with': (language) => language.surround.open(),
    'surround-with-live-template': (language) => language.surround.openTemplates(),
    unwrap: (language) => language.surround.unwrap(),
    'save-as-live-template': (language) => void language.templates.saveSelection()
};

/* Ghost text, inline edit, explain and the selection to chat wait for a document a language server serves. */
const SERVED_ONLY = new Set<LanguageCommandId>(['selection-to-chat', 'inline-edit', 'show-inline-edit', 'explain', 'suggest-inline']);

interface LanguageCommandRow {
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
                const language = languageForCommand();
                if (language !== null && (language.served || !SERVED_ONLY.has(id))) {
                    RUNNERS[id](language);
                }
            });
        }
    }));
}
