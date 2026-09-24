const RELOADED_KEY = 'ruimte:stale-chunk-reload';

interface StaleChunkWatch {
    target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
    storage: Pick<Storage, 'getItem' | 'setItem'>;
    reload(): void;
    /* Names the build the page runs, so a page that reloaded into a newer one may reload once more after its next deploy. */
    build: string;
    /* A chunk only a prefetch asked for is no reason to reload under a person; their own open will fail again. */
    prefetching?: () => boolean;
}

/*
 * A deploy of the web client removes the chunks of the build a page was loaded from, so the first
 * lazy surface that page opens after it fails to load. One reload fetches the new build. The flag
 * stops there: a build whose own chunks fail would otherwise reload forever.
 */
export function reloadOnStaleChunk({ target, storage, reload, build, prefetching = () => false }: StaleChunkWatch): () => void {
    const claimReload = (): boolean => {
        try {
            if (storage.getItem(RELOADED_KEY) === build) {
                return false;
            }
            storage.setItem(RELOADED_KEY, build);
            return true;
        } catch {
            // Without a flag that sticks there is no way to tell a second failure from the first.
            return false;
        }
    };
    const onPreloadError = (): void => {
        if (!prefetching() && claimReload()) {
            reload();
        }
    };
    target.addEventListener('vite:preloadError', onPreloadError);
    return () => target.removeEventListener('vite:preloadError', onPreloadError);
}
