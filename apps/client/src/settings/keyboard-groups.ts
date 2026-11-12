import { commandRows } from '@/commands/palette-rows';
import { arrangeShortcuts } from '@/settings/arrange-shortcuts';
import { shellPlatform, type ShortcutGroup } from '@/settings/shortcuts';
import { overridesSnapshot, type OverrideSnapshot } from '@/surface/shortcut-overrides';

/* Every category of the Keyboard pane. The commands follow canvas state (layouts, locks), so read this when it is drawn. */
export function keyboardGroups(apple: boolean, snapshot: OverrideSnapshot = overridesSnapshot(), shell: string | null = shellPlatform()): ShortcutGroup[] {
    return arrangeShortcuts(apple, commandRows(), snapshot, shell);
}
