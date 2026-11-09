import type { Command } from '@/commands/behavior';
import { commandRows } from '@/commands/palette-rows';
import { extensionCommands, type ExtensionRows } from '@/extensions/palette-commands';
import { useContributions } from '@/state/extension-registry';

export type { Command };

/* The handful of rows an empty palette offers; a palette that opens on forty rows is a list to read rather than a place to type. */
export const OPENING_COMMAND_IDS: readonly string[] = ['add-chat', 'add-terminal', 'view-new', 'find-in-files', 'open-folder', 'usage', 'settings'];

export function appCommands(contributions: ExtensionRows = useContributions.getState()): Command[] {
    return [...commandRows(), ...extensionCommands(contributions)];
}
