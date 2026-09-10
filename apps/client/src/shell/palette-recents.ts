const STORAGE_KEY = 'ruimte.palette.recents';

/* How many run commands the palette offers back on an empty query. Five fills the first screen
   without pushing "Jump to" out of sight. */
export const RECENT_LIMIT = 5;

/* Ids only: a command's label and what it does are rebuilt from `appCommands()` every time, so a
   remembered row can never run something that has since changed. */
export const nextRecents = (current: string[], id: string): string[] => [id, ...current.filter((entry) => entry !== id)].slice(0, RECENT_LIMIT);

export const readRecents = (): string[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string').slice(0, RECENT_LIMIT) : [];
    } catch {
        return [];
    }
};

export const rememberRecent = (id: string): string[] => {
    const next = nextRecents(readRecents(), id);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Storage that refuses keeps the order for this session only.
    }
    return next;
};

/* The remembered ids as rows, newest first, and everything else after them. A remembered id that
   no longer exists (a deleted layout, an agent CLI that went away) simply drops out. */
export const sortByRecency = <T extends { id: string }>(entries: T[], recents: string[]): { recent: T[]; rest: T[] } => {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const recent = recents.map((id) => byId.get(id)).filter((entry): entry is T => entry !== undefined);
    const taken = new Set(recent.map((entry) => entry.id));
    return { recent, rest: entries.filter((entry) => !taken.has(entry.id)) };
};
