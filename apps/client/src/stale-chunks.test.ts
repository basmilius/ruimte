import { describe, expect, test } from 'bun:test';
import { reloadOnStaleChunk } from '@/stale-chunks';
import { memoryStorage } from '../testing/memory-storage';

type Watch = Parameters<typeof reloadOnStaleChunk>[0];

/* A page on build A that counts its reloads; `fail` is a chunk that did not load. */
function page(options: Partial<Watch> = {}) {
    const target = new EventTarget();
    const counted = { reloads: 0 };
    const stop = reloadOnStaleChunk({ target, storage: memoryStorage(), reload: () => counted.reloads++, build: '/assets/index-a.js', ...options });
    const fail = (): void => {
        target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    };
    return { counted, stop, fail };
}

function failedOpens() {
    const listeners = new Set<() => void>();
    return {
        subscribe: (listener: () => void): (() => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        fail: (): void => {
            for (const listener of listeners) {
                listener();
            }
        },
        listening: (): number => listeners.size
    };
}

describe('reloading on a stale chunk', () => {
    test('reloads exactly once, however many chunks fail', () => {
        const { counted, fail } = page();
        fail();
        fail();
        fail();
        expect(counted.reloads).toBe(1);
    });

    test('a page that came back on the same build does not reload again, one on a newer build may once more', () => {
        const storage = memoryStorage();
        const before = page({ storage });
        before.fail();
        const same = page({ storage });
        same.fail();
        const newer = page({ storage, build: '/assets/index-b.js' });
        newer.fail();
        newer.fail();
        expect([before.counted.reloads, same.counted.reloads, newer.counted.reloads]).toEqual([1, 0, 1]);
    });

    test('never reloads when the flag cannot be kept', () => {
        const storage = {
            getItem: () => null,
            setItem: () => {
                throw new Error('storage is disabled');
            }
        };
        const { counted, fail } = page({ storage });
        fail();
        expect(counted.reloads).toBe(0);
    });

    test('stops listening once disposed', () => {
        const { counted, stop, fail } = page();
        stop();
        fail();
        expect(counted.reloads).toBe(0);
    });
});

describe('a failed open beside a prefetch', () => {
    test('a chunk only a prefetch asked for does not reload', () => {
        const { counted, fail } = page({ prefetching: () => true });
        fail();
        expect(counted.reloads).toBe(0);
    });

    test('a surface a person opened reloads, even while a prefetch runs', () => {
        const opens = failedOpens();
        const { counted, fail } = page({ prefetching: () => true, failedOpen: opens.subscribe });
        fail();
        opens.fail();
        expect(counted.reloads).toBe(1);
    });

    test('a failed open and its own preload error reload once', () => {
        const opens = failedOpens();
        const { counted, fail } = page({ failedOpen: opens.subscribe });
        fail();
        opens.fail();
        expect(counted.reloads).toBe(1);
    });

    test('disposing stops listening to failed opens', () => {
        const opens = failedOpens();
        const { stop } = page({ failedOpen: opens.subscribe });
        expect(opens.listening()).toBe(1);
        stop();
        expect(opens.listening()).toBe(0);
    });
});
