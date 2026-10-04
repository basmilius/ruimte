import { appCommands } from '@/shell/commands';
import { commandShortcuts, shortcutGroups, type ShortcutGroup } from '@/shell/settings/shortcuts';

/* Every category of the Keyboard pane, the commands that carry a shortcut first. They follow canvas state (layouts, locks), so read this when it is drawn. */
export function keyboardGroups(apple: boolean): ShortcutGroup[] {
    return [commandShortcuts(appCommands()), ...shortcutGroups(apple)];
}
