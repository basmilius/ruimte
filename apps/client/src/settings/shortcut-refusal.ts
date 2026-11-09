import { shortcutText, type Shortcut } from '@adecore/ui';
import { matchesExtensionShortcut } from '@/extensions/action-shortcuts';
import type { ShortcutGroup } from '@/settings/shortcuts';
import type { RowId } from '@/surface/shortcut-overrides';
import { BROWSER_KEEPS } from '@/surface/shortcuts';

/* Why a key cannot be a row's, for the Keyboard pane to put in words. */
export type ShortcutRefusal = { reason: 'modifier' } | { reason: 'browser' } | { reason: 'taken'; label: string };

/* The key as the keyboard sends it, so Mod on macOS and Meta compare as the one key they are. */
function signature(key: Shortcut, apple: boolean): string {
    const meta = key.meta || (key.mod && apple);
    const ctrl = key.ctrl || (key.mod && !apple);

    return [meta, ctrl, key.alt, key.shift, key.key].join('|');
}

/* Whether an extension binds the key too, which Ruimte's own listener answers first. */
export function extensionUsesKey(extensionShortcuts: readonly string[], key: Shortcut, apple: boolean): boolean {
    const event = {
        key: key.key.toLowerCase(),
        metaKey: apple ? key.mod || key.meta : key.meta,
        ctrlKey: apple ? key.ctrl : key.mod || key.ctrl,
        shiftKey: key.shift,
        altKey: key.alt
    };

    return extensionShortcuts.some((candidate) => matchesExtensionShortcut(candidate, event, apple));
}

export function sameKey(one: Shortcut, other: Shortcut, apple: boolean): boolean {
    return signature(one, apple) === signature(other, apple);
}

interface RefusalContext {
    apple: boolean;
    /* A page in a browser tab never sees the keys the browser keeps. */
    browserTab: boolean;
}

/*
 * Why a recorded key is refused for a row, or null when it may be the row's. Every shortcut needs Mod, Ctrl, Meta or
 * Alt, since Shift alone is a letter typed. A key another row answers to is not taken from it, whether the row can be
 * rebound or is fixed: the panel lists them all, so the holder is named from it. Where a key is used (a canvas, a
 * terminal, an editor) stays out of it, because nearly every key overlaps another place somewhere.
 */
export function refusalOf(next: Shortcut, row: RowId, groups: readonly ShortcutGroup[], { apple, browserTab }: RefusalContext): ShortcutRefusal | null {
    if (!(next.mod || next.ctrl || next.meta || next.alt)) {
        return { reason: 'modifier' };
    }

    const own = groups.flatMap((group) => group.shortcuts).find((candidate) => candidate.id === row);

    // The key the row has already is no change.
    if (own !== undefined && sameKey(own.keys, next, apple)) {
        return null;
    }

    if (browserTab && BROWSER_KEEPS.some((kept) => shortcutText(kept) === shortcutText(next))) {
        return { reason: 'browser' };
    }

    const holder = groups
        .flatMap((group) => group.shortcuts)
        .find((candidate) => candidate.id !== row && candidate.then === undefined && candidate.keys.key !== '' && sameKey(candidate.keys, next, apple));

    return holder === undefined ? null : { reason: 'taken', label: holder.label };
}
