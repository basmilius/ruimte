/* A key as `before-input-event` reports it for the page. */
export interface PageKey {
    type: string;
    meta: boolean;
    control: boolean;
}

/* How long after the page had a key the menu may still be answering it: the page's round trip, with room for a busy one. */
export const PAGE_KEY_MS = 1000;

/*
 * Whether a menu item that Electron says its accelerator fired answers a key the page already had.
 * Electron says so for every pick that is not a mouse click, so an item picked through accessibility
 * or with the keyboard inside the menu reads as fired by its key as well, and a key sent to the app
 * while none of its windows is key reaches the menu without the page ever seeing it. Only a key with
 * Cmd or Ctrl counts, since the menu binds no other.
 */
export const createPageKeys = (now: () => number = Date.now) => {
    // One entry per key, so a held key that repeats before the menu answers the first still answers each.
    let seen: number[] = [];
    return {
        saw: (key: PageKey): void => {
            if (key.type === 'keyDown' && (key.meta || key.control)) {
                seen.push(now());
            }
        },
        take: (): boolean => {
            const since = now() - PAGE_KEY_MS;
            seen = seen.filter((at) => at >= since);
            return seen.shift() !== undefined;
        }
    };
};
