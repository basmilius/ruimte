import { shortcut, type Shortcut } from '@basmilius/desktop-ui';
import { chordOf, type KeymapId } from '@ruimte/smart-editor/keymap';
import { isApplePlatform } from '@/desktop/bridge';

/*
 * The key of an editor or language command on a platform, from the one table the editor binds its keys
 * with (`@ruimte/smart-editor/keymap`). A menu, the palette and a handler read it here, so what is printed
 * is what answers. Undefined where the platform has no key for it.
 */
export function shortcutFor(id: KeymapId, apple: boolean): Shortcut | undefined {
    const chord = chordOf(id, apple);
    return chord === null ? undefined : shortcut(chord);
}

/* The key on this platform. */
export function editorShortcut(id: KeymapId): Shortcut | undefined {
    return shortcutFor(id, isApplePlatform());
}

/* For the commands that have a key on every platform. */
export function requiredShortcut(id: KeymapId): Shortcut {
    const found = editorShortcut(id);
    if (found === undefined) {
        throw new Error(`The editor key "${id}" has no chord on this platform`);
    }
    return found;
}
