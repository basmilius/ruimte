import { matchesShortcut, type Shortcut, isApplePlatform } from '@adecore/ui';

/* Whether a key event is the shortcut, on this platform's idea of Mod. */
export function isShortcut(target: Shortcut, event: KeyboardEvent): boolean {
    return matchesShortcut(target, event, isApplePlatform());
}
