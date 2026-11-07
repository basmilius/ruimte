import { matchesShortcut, type Shortcut } from '@adecore/ui';
import { isApplePlatform } from '@/desktop/bridge';

/* Whether a key event is the shortcut, on this platform's idea of Mod. A row without a key on this platform is none. */
export function isShortcut(target: Shortcut | undefined, event: KeyboardEvent): boolean {
    return target !== undefined && matchesShortcut(target, event, isApplePlatform());
}
