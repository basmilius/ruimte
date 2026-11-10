import type { Command } from '@/commands/behavior';
import type { CommandMoment } from '@/commands/moment';
import { editorCommandRows } from '@/language/editor-commands';
import { languageCommandRows } from '@/language/language-commands';

/* The language and editing rows, which run against the editor the palette hands the focus back to. */
export function languagePaletteRows(moment: CommandMoment): Command[] {
    return moment.inWorkspace ? [...languageCommandRows(), ...editorCommandRows()] : [];
}
