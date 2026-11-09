import { matchesShortcut, type KeyLike, type Shortcut } from '@adecore/ui';
import type { CommandSpec, MenuPlace } from '@/commands/types';
import { hasDefaultKey } from '@/surface/default-keys';
import { isRebound, keyIn, overridesSnapshot, type OverrideSnapshot } from '@/surface/shortcut-overrides';

const specs = new Map<string, CommandSpec>();
let bound: Record<'window' | 'workspace', { snapshot: OverrideSnapshot; keys: [string, Shortcut][] }> | null = null;

/* Adds the rows of one feature's `command-table.ts`, in order. An id twice is a wiring mistake. */
export function registerCommands(table: Readonly<Record<string, CommandSpec>>): void {
    for (const [id, spec] of Object.entries(table)) {
        if (specs.has(id)) {
            throw new Error(`The command "${id}" is registered twice.`);
        }
        specs.set(id, spec);
    }
    bound = null;
}

export function isCommandId(id: string): boolean {
    return specs.has(id);
}

export function commandSpec(id: string): CommandSpec {
    const spec = specs.get(id);
    if (spec === undefined) {
        throw new Error(`The command "${id}" is not registered.`);
    }

    return spec;
}

/* Every command a person is offered, in the order the features registered them. */
export function commandIds(): readonly string[] {
    return [...specs.keys()];
}

export function menuPlacesOf(id: string): readonly MenuPlace[] {
    const places = commandSpec(id).menu;
    if (places === undefined) {
        return [];
    }

    return 'menu' in places ? [places as MenuPlace] : (places as readonly MenuPlace[]);
}

/*
 * The key a row answers to now: the one of the row it shows, the key of the editor's keymap that answers it,
 * a rebound or default key, or the fixed key it has for good. Read against a snapshot, a component that
 * redraws with the overrides gets the key they give.
 */
export function commandKey(id: string, snapshot: OverrideSnapshot = overridesSnapshot()): Shortcut | undefined {
    const { shortcut, keyOf, keymap } = commandSpec(id);

    if (keyOf !== undefined) {
        return keyIn(snapshot, keyOf);
    }

    if (keymap !== undefined) {
        return keyIn(snapshot, keymap);
    }

    return hasDefaultKey(id) ? keyIn(snapshot, id) : shortcut;
}

function boundLists(): Record<'window' | 'workspace', [string, Shortcut][]> {
    const snapshot = overridesSnapshot();

    if (bound?.window.snapshot !== snapshot) {
        const listeners = { window: [] as [string, Shortcut][], workspace: [] as [string, Shortcut][] };

        for (const [id, { binds, aliases }] of specs) {
            const key = commandKey(id, snapshot);

            if (binds === undefined || key === undefined) {
                continue;
            }

            // An alias belongs to the key the row starts with.
            for (const own of [key, ...(isRebound(snapshot, id) ? [] : (aliases ?? []))]) {
                listeners[binds].push([id, own]);
            }
        }

        // The rows a person rebound first, so a default of a later release never takes their key.
        const ordered = (rows: [string, Shortcut][]): [string, Shortcut][] => [
            ...rows.filter(([id]) => isRebound(snapshot, id)),
            ...rows.filter(([id]) => !isRebound(snapshot, id))
        ];

        bound = { window: { snapshot, keys: ordered(listeners.window) }, workspace: { snapshot, keys: ordered(listeners.workspace) } };
    }

    return { window: bound.window.keys, workspace: bound.workspace.keys };
}

export function boundCommands(listener: 'window' | 'workspace'): readonly [string, Shortcut][] {
    return boundLists()[listener];
}

export function commandForKey(listener: 'window' | 'workspace', e: KeyLike, apple: boolean): string | null {
    return boundLists()[listener].find(([, shortcut]) => matchesShortcut(shortcut, e, apple))?.[0] ?? null;
}
