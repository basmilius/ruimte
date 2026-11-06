import { matchesShortcut, type KeyLike, type Shortcut } from '@adecore/ui';
import type { CommandSpec, MenuPlace } from '@/commands/types';

const specs = new Map<string, CommandSpec>();
let bound: Record<'window' | 'workspace', [string, Shortcut][]> | null = null;

/* Keeps the keys of a feature's table typed by its own ids, which the global registry cannot. */
export function defineCommands<const Table extends Record<string, CommandSpec>>(table: Table): Table {
    return table;
}

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

function boundLists(): Record<'window' | 'workspace', [string, Shortcut][]> {
    if (bound === null) {
        bound = { window: [], workspace: [] };
        for (const [id, { binds, shortcut }] of specs) {
            if (binds !== undefined && shortcut !== undefined) {
                bound[binds].push([id, shortcut]);
            }
        }
    }

    return bound;
}

/* The rows one listener binds, each with its key. */
export function boundCommands(listener: 'window' | 'workspace'): readonly [string, Shortcut][] {
    return boundLists()[listener];
}

/* The command a keystroke is for one listener, or null for a key that is none of its. */
export function commandForKey(listener: 'window' | 'workspace', e: KeyLike, apple: boolean): string | null {
    return boundLists()[listener].find(([, shortcut]) => matchesShortcut(shortcut, e, apple))?.[0] ?? null;
}
