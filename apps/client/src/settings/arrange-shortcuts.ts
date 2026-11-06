import { commandArea, editorShortcutRows, isEditorCommand } from '@/settings/editor-shortcuts';
import { areaTitle, KEYBOARD_AREAS, shortcutGroups, type KeyboardArea, type ShortcutGroup, type ShortcutRow } from '@/settings/shortcuts';
import type { Command } from '@/shell/commands';

/*
 * Every category of the Keyboard pane: the shortcuts the handlers bind, the commands that carry one in the
 * category of their menu, and the editor's keymap. A command whose key the editor's keymap lists is not a
 * command row here, so nothing shows twice.
 */
export function arrangeShortcuts(apple: boolean, commands: readonly Pick<Command, 'id' | 'label' | 'shortcut'>[]): ShortcutGroup[] {
    const rows = new Map<KeyboardArea, ShortcutRow[]>(KEYBOARD_AREAS.map((area) => [area, []]));
    for (const group of shortcutGroups(apple)) {
        rows.get(group.id)!.push(...group.shortcuts);
    }
    for (const command of commands) {
        if (command.shortcut !== undefined && !isEditorCommand(command.id)) {
            rows.get(commandArea(command.id))!.push({ keys: command.shortcut, label: command.label });
        }
    }
    for (const { area, row } of editorShortcutRows(apple)) {
        rows.get(area)!.push(row);
    }
    return KEYBOARD_AREAS.map((area) => ({ id: area, title: areaTitle(area), shortcuts: rows.get(area)! }));
}
