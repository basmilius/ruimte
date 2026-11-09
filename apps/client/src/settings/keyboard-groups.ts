import { commandRows } from '@/commands/palette-rows';
import { arrangeShortcuts } from '@/settings/arrange-shortcuts';
import type { ShortcutGroup } from '@/settings/shortcuts';
import { overridesSnapshot, type OverrideSnapshot } from '@/surface/shortcut-overrides';

/* Every category of the Keyboard pane. The commands follow canvas state (layouts, locks), so read this when it is drawn. */
export function keyboardGroups(apple: boolean, snapshot: OverrideSnapshot = overridesSnapshot()): ShortcutGroup[] {
    return arrangeShortcuts(apple, commandRows(), snapshot);
}
