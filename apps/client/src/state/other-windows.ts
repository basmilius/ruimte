export type StorageTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

/*
 * Every window of the app is a page of one origin, and they share `localStorage`. A store that read
 * its key once would keep a stale copy, and write it over the next change another window made. The
 * `storage` event fires in every page but the one that wrote, which is the shape this needs: the
 * writer keeps what it has and the others read again. A key of null is the whole storage cleared.
 */
export const followOtherWindows = (
    key: string,
    reread: () => void,
    target: StorageTarget | null = typeof window === 'undefined' ? null : window
): (() => void) => {
    if (target === null) {
        return () => undefined;
    }
    const onStorage = (event: StorageEvent): void => {
        if (event.key === key || event.key === null) {
            reread();
        }
    };
    target.addEventListener('storage', onStorage);
    return () => target.removeEventListener('storage', onStorage);
};
