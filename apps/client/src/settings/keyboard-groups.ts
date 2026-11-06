import { commandRows } from '@/commands/palette-rows';
import { arrangeShortcuts } from '@/settings/arrange-shortcuts';
import type { ShortcutGroup } from '@/settings/shortcuts';

/* Every category of the Keyboard pane. The commands follow canvas state (layouts, locks), so read this when it is drawn. */
export function keyboardGroups(apple: boolean): ShortcutGroup[] {
    return arrangeShortcuts(apple, commandRows());
}
