import { KEYMAP_IDS, resolveKeymap, type Keymap, type KeymapId, type KeymapOverrides } from '@adecore/editor/keymap';
import { shortcut, shortcutText, type Shortcut } from '@adecore/ui';
import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { isApplePlatform } from '@/desktop/bridge';
import { DEFAULT_KEYS, hasDefaultKey, type DefaultKeyId } from '@/shell/default-keys';
import { RUIMTE_KEYMAP_OVERRIDES, shortcutFor } from '@/shell/editor-keymap';
import { browserStorage, storedJson, type KeyValueStorage } from '@/state/stored-json';

/* The row ids a person can give a key of their own: command ids, and the keys of the editor's keymap. */
export type RowId = DefaultKeyId | KeymapId;

export const SHORTCUT_OVERRIDES_KEY = 'ruimte.shortcuts';

function isKeymapId(id: string): id is KeymapId {
    return (KEYMAP_IDS as readonly string[]).includes(id);
}

/*
 * A map from row id to chord text. Every entry is kept as it was read, so one this release cannot parse or an id it
 * does not know survives a write, and going back a version loses nothing.
 */
const EntriesSchema = z.record(z.string(), z.unknown());

type Entries = Readonly<Record<string, unknown>>;

export interface OverrideSnapshot {
    /* The overrides that parse, by row id. */
    readonly keys: ReadonlyMap<string, Shortcut>;
}

function parsedKeys(entries: Entries): ReadonlyMap<string, Shortcut> {
    const keys = new Map<string, Shortcut>();

    for (const [id, text] of Object.entries(entries)) {
        if (typeof text !== 'string') {
            continue;
        }

        try {
            const parsed = shortcut(text);

            // A chord of modifiers alone matches no key.
            if (parsed.key !== '') {
                keys.set(id, parsed);
            }
        } catch {
            // Kept in the storage, ignored here.
        }
    }

    return keys;
}

export interface ShortcutOverrides {
    snapshot(): OverrideSnapshot;
    subscribe(listener: () => void): () => void;
    set(id: string, key: Shortcut): void;
    remove(id: string): void;
    removeMany(ids: readonly string[]): void;
    /* Reads the storage again, for a write another window made. */
    reload(): void;
}

/* The overrides of one client over a storage; the app has one (`overrides` below), and a test brings a fake storage. */
export function createShortcutOverrides(storage: () => KeyValueStorage | null = browserStorage): ShortcutOverrides {
    const stored = storedJson<Entries>(SHORTCUT_OVERRIDES_KEY, EntriesSchema);
    const listeners = new Set<() => void>();
    let entries: Entries = stored.read(storage()) ?? {};
    let current: OverrideSnapshot = { keys: parsedKeys(entries) };

    function notify(): void {
        for (const listener of [...listeners]) {
            listener();
        }
    }

    function change(next: Entries): void {
        entries = next;
        current = { keys: parsedKeys(entries) };
        // A storage that refuses the write keeps the overrides for this session.
        stored.write(entries, storage());
        notify();
    }

    function removeMany(ids: readonly string[]): void {
        const kept = Object.fromEntries(Object.entries(entries).filter(([id]) => !ids.includes(id)));

        if (Object.keys(kept).length !== Object.keys(entries).length) {
            change(kept);
        }
    }

    return {
        snapshot: () => current,
        subscribe(listener) {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        set(id, key) {
            change({ ...entries, [id]: shortcutText(key) });
        },
        remove: (id) => removeMany([id]),
        removeMany,
        reload() {
            entries = stored.read(storage()) ?? {};
            current = { keys: parsedKeys(entries) };
            notify();
        }
    };
}

const overrides = createShortcutOverrides();

export const overridesSnapshot = overrides.snapshot;
export const subscribeOverrides = overrides.subscribe;
export const reloadOverrides = overrides.reload;

export function setOverride(id: RowId, key: Shortcut): void {
    overrides.set(id, key);
}

export function removeOverride(id: RowId): void {
    overrides.remove(id);
}

/* Restore defaults for these rows; an entry of another id stays. */
export function removeOverrideOf(ids: readonly RowId[]): void {
    overrides.removeMany(ids);
}

/* The key a row has out of the box, undefined for a key the platform leaves unbound. */
export function defaultKeyOf(id: DefaultKeyId): Shortcut;
export function defaultKeyOf(id: KeymapId): Shortcut | undefined;
export function defaultKeyOf(id: RowId): Shortcut | undefined {
    return hasDefaultKey(id) ? DEFAULT_KEYS[id] : shortcutFor(id, isApplePlatform());
}

/* A pure read of one snapshot, so a component that read the snapshot from the store redraws with it. */
export function keyIn(snapshot: OverrideSnapshot, id: DefaultKeyId): Shortcut;
export function keyIn(snapshot: OverrideSnapshot, id: KeymapId): Shortcut | undefined;
export function keyIn(snapshot: OverrideSnapshot, id: RowId): Shortcut | undefined {
    return snapshot.keys.get(id) ?? defaultKeyOf(id as DefaultKeyId);
}

/* The key a row answers to now. */
export function keyOf(id: DefaultKeyId): Shortcut;
export function keyOf(id: KeymapId): Shortcut | undefined;
export function keyOf(id: RowId): Shortcut | undefined {
    return keyIn(overridesSnapshot(), id as DefaultKeyId);
}

export function useKeyOf(id: DefaultKeyId): Shortcut;
export function useKeyOf(id: KeymapId): Shortcut | undefined;
export function useKeyOf(id: RowId): Shortcut | undefined {
    return keyIn(useOverrides(), id as DefaultKeyId);
}

/* The snapshot of the overrides, for a component that reads several rows. */
export function useOverrides(): OverrideSnapshot {
    return useSyncExternalStore(subscribeOverrides, overridesSnapshot);
}

export function isRebound(snapshot: OverrideSnapshot, id: RowId): boolean {
    return snapshot.keys.has(id);
}

const keymaps = new WeakMap<OverrideSnapshot, Keymap>();

/* The editor's keymap with the overrides of its keys, which an open editor reads again on every key press. */
export function currentEditorKeymap(snapshot: OverrideSnapshot = overridesSnapshot()): Keymap {
    const found = keymaps.get(snapshot);

    if (found !== undefined) {
        return found;
    }

    const merged: KeymapOverrides = { ...RUIMTE_KEYMAP_OVERRIDES };

    for (const [id, key] of snapshot.keys) {
        if (isKeymapId(id)) {
            const chord = shortcutText(key);
            merged[id] = { ...merged[id], mac: chord, other: chord };
        }
    }

    const keymap = resolveKeymap(merged);
    keymaps.set(snapshot, keymap);

    return keymap;
}

let recording = false;

/* Whether a shortcut is being recorded, which the window's own key listeners wait for. */
export function isShortcutRecording(): boolean {
    return recording;
}

export function setShortcutRecording(value: boolean): void {
    recording = value;
}
