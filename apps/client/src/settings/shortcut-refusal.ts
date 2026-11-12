import { shortcutText, type Shortcut } from '@adecore/ui';
import { matchesExtensionShortcut } from '@/extensions/action-shortcuts';
import type { ShortcutGroup, ShortcutRow } from '@/settings/shortcuts';
import { defaultKeyOf, type RowId } from '@/surface/shortcut-overrides';
import { BROWSER_KEEPS, MAC_BROWSER_KEEPS } from '@/surface/shortcuts';

type TakenRefusal = { reason: 'taken'; label: string };
type ShortcutRefusal = { reason: 'modifier' } | { reason: 'browser' } | TakenRefusal;

/* The key as the keyboard sends it, so Mod on macOS and Meta compare as the one key they are. */
function signature(key: Shortcut, apple: boolean): string {
    const meta = key.meta || (key.mod && apple);
    const ctrl = key.ctrl || (key.mod && !apple);

    return [meta, ctrl, key.alt, key.shift, key.key].join('|');
}

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

    if (own !== undefined && sameKey(own.keys, next, apple)) {
        return null;
    }

    const kept = apple ? [...BROWSER_KEEPS, ...MAC_BROWSER_KEEPS] : BROWSER_KEEPS;

    if (browserTab && kept.some((key) => shortcutText(key) === shortcutText(next))) {
        return { reason: 'browser' };
    }

    return takenBy(next, row, groups, apple);
}

/*
 * Why a row may not go back to its default key, or null when it may. Only a holder counts: a default may lack a modifier
 * on purpose, and a browser tab already says which defaults it keeps. And only a holder a person moved onto the key:
 * two defaults that share a key in different places (the palette and a terminal's clear) were shipped that way, and a
 * fixed holder is one a person could never move out of the way.
 */
export function resetRefusalOf(fallback: Shortcut | undefined, row: RowId, groups: readonly ShortcutGroup[], apple: boolean): TakenRefusal | null {
    if (fallback === undefined) {
        return null;
    }

    return takenBy(fallback, row, groups, apple, (holder) => {
        if (holder.id === undefined) {
            return false;
        }

        const shipped = defaultKeyOf(holder.id);

        return shipped === undefined || !sameKey(shipped, fallback, apple);
    });
}

function takenBy(
    next: Shortcut,
    row: RowId,
    groups: readonly ShortcutGroup[],
    apple: boolean,
    counts: (holder: ShortcutRow) => boolean = () => true
): TakenRefusal | null {
    const holder = groups
        .flatMap((group) => group.shortcuts)
        .find(
            (candidate) =>
                candidate.id !== row && candidate.then === undefined && candidate.keys.key !== '' && sameKey(candidate.keys, next, apple) && counts(candidate)
        );

    return holder === undefined ? null : { reason: 'taken', label: holder.label };
}
