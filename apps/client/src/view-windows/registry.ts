import { auxWindowKey, splitAuxWindowKey } from '@ruimte/desktop-bridge';
import { z } from 'zod';
import { followOtherWindows, type StorageTarget } from '@/state/other-windows';
import { storedJson, type KeyValueStorage } from '@/state/stored-json';

const AUX_VIEWS_KEY = 'ruimte.auxViews';

/*
 * The views of a project each auxiliary window has, by the window's key. Every window reads the same
 * storage, so the window that has the project learns here which views it must leave alone. Which of
 * these windows are still open only the shell knows (`auxWindows`).
 */
const stored = storedJson<Record<string, string[]>>(AUX_VIEWS_KEY, z.record(z.string(), z.array(z.string())));

export function readAuxViews(storage?: KeyValueStorage | null): Record<string, string[]> {
    return stored.read(storage) ?? {};
}

function sameIds(before: readonly string[] | undefined, ids: readonly string[] | null): boolean {
    if (before === undefined || ids === null) {
        return before === undefined && ids === null;
    }

    return before.length === ids.length && before.every((id, at) => id === ids[at]);
}

/* Null takes the window out of the list. */
export function writeAuxViews(key: string, ids: readonly string[] | null, storage?: KeyValueStorage | null): void {
    const all = readAuxViews(storage);

    // Every write wakes the other windows, so one that changes nothing is skipped.
    if (sameIds(all[key], ids)) {
        return;
    }

    if (ids === null) {
        delete all[key];
    } else {
        all[key] = [...ids];
    }

    stored.write(all, storage);
}

/* The auxiliary window that has each view of a project, among the windows in `alive`. */
export function awayViewsOf(project: string, alive: readonly string[], storage?: KeyValueStorage | null): Map<string, string> {
    const all = readAuxViews(storage);
    const away = new Map<string, string>();

    for (const aux of alive) {
        for (const viewId of all[auxWindowKey(project, aux)] ?? []) {
            away.set(viewId, aux);
        }
    }

    return away;
}

/* Drops the entries of a project's auxiliary windows that are not in `alive`. */
export function pruneAuxViews(project: string, alive: readonly string[], storage?: KeyValueStorage | null): void {
    const all = readAuxViews(storage);

    const gone = Object.keys(all).filter((key) => {
        const aux = splitAuxWindowKey(key);

        return aux !== null && aux.project === project && !alive.includes(aux.id);
    });

    if (gone.length === 0) {
        return;
    }

    for (const key of gone) {
        delete all[key];
    }

    stored.write(all, storage);
}

export function followAuxViews(reread: () => void, target?: StorageTarget | null): () => void {
    return followOtherWindows(AUX_VIEWS_KEY, reread, target);
}
