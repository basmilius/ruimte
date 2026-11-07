import { appCommands } from '@/shell/commands';
import { arrangeShortcuts } from '@/shell/settings/arrange-shortcuts';
import type { ShortcutGroup } from '@/shell/settings/shortcuts';
import { overridesSnapshot, type OverrideSnapshot } from '@/shell/shortcut-overrides';

/* Every category of the Keyboard pane. The commands follow canvas state (layouts, locks), so read this when it is drawn. */
export function keyboardGroups(apple: boolean, snapshot: OverrideSnapshot = overridesSnapshot()): ShortcutGroup[] {
    return arrangeShortcuts(apple, appCommands(), snapshot);
}
