import { appCommands } from '@/shell/commands';
import { commandShortcuts, shortcutGroups, type ShortcutGroup } from '@/shell/settings/shortcuts';

/* Every category of the Keyboard pane, the commands that carry a shortcut first. They follow canvas state (layouts, locks), so read this when it is drawn. */
export const keyboardGroups = (apple: boolean): ShortcutGroup[] => [commandShortcuts(appCommands()), ...shortcutGroups(apple)];
