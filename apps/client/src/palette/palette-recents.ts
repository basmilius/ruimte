import { z } from 'zod';
import { storedJson } from '@/state/stored-json';

/* Five fills the first screen of an empty palette without pushing "Jump to" out of sight. */
export const RECENT_LIMIT = 5;

const storedRecents = storedJson(
    'ruimte.palette.recents',
    z.array(z.unknown()).transform((items) => items.filter((item): item is string => typeof item === 'string'))
);

/* Ids only: a command's label and what it does are rebuilt from `appCommands()` every time, so a
   remembered row can never run something that has since changed. */
export function nextRecents(current: string[], id: string): string[] {
    return [id, ...current.filter((entry) => entry !== id)].slice(0, RECENT_LIMIT);
}

export function readRecents(): string[] {
    return (storedRecents.read() ?? []).slice(0, RECENT_LIMIT);
}

export function rememberRecent(id: string): string[] {
    const next = nextRecents(readRecents(), id);
    storedRecents.write(next);
    return next;
}

/* The remembered ids as rows, newest first, and everything else after them. A remembered id that
   no longer exists (a deleted layout, an agent CLI that went away) simply drops out. */
export function sortByRecency<T extends { id: string }>(entries: T[], recents: string[]): { recent: T[]; rest: T[] } {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const recent = recents.map((id) => byId.get(id)).filter((entry): entry is T => entry !== undefined);
    const taken = new Set(recent.map((entry) => entry.id));
    return { recent, rest: entries.filter((entry) => !taken.has(entry.id)) };
}
