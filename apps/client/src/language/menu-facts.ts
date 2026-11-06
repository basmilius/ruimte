import type { MenuFacts, MenuHost } from '@/commands/menu-context';
import { availableLanguageForCommand } from '@/language/focused-language';
import { availableEditorForCommand } from '@/surface/panels/focused-editor';

declare module '@/commands/menu-context' {
    interface MenuFacts {
        /* An editor with a language server has the keyboard, so the Go to rows can act. */
        languageAvailable: boolean;
        /* An editor has the keyboard. */
        editorAvailable: boolean;
    }
}

export function languageFacts(_host: MenuHost): Pick<MenuFacts, 'languageAvailable' | 'editorAvailable'> {
    return { languageAvailable: availableLanguageForCommand() !== null, editorAvailable: availableEditorForCommand() !== null };
}
