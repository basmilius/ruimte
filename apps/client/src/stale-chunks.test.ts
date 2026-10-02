import { describe, expect, test } from 'bun:test';
import { reloadOnStaleChunk } from '@/stale-chunks';

const memoryStorage = (): Pick<Storage, 'getItem' | 'setItem'> => {
    const values = new Map<string, string>();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
            values.set(key, value);
        }
    };
};

const preloadError = (): Event => new Event('vite:preloadError', { cancelable: true });

describe('reloading on a stale chunk', () => {
    test('reloads exactly once, however many chunks fail', () => {
        const target = new EventTarget();
        let reloads = 0;
        reloadOnStaleChunk({ target, storage: memoryStorage(), reload: () => reloads++, build: '/assets/index-a.js' });
        target.dispatchEvent(preloadError());
        target.dispatchEvent(preloadError());
        target.dispatchEvent(preloadError());
        expect(reloads).toBe(1);
    });

    test('a page that came back on the same build does not reload again', () => {
        const storage = memoryStorage();
        let reloads = 0;
        const before = new EventTarget();
        reloadOnStaleChunk({ target: before, storage, reload: () => reloads++, build: '/assets/index-a.js' });
        before.dispatchEvent(preloadError());
        const after = new EventTarget();
        reloadOnStaleChunk({ target: after, storage, reload: () => reloads++, build: '/assets/index-a.js' });
        after.dispatchEvent(preloadError());
        expect(reloads).toBe(1);
    });

    test('a page on a newer build may reload once after the next deploy', () => {
        const storage = memoryStorage();
        let reloads = 0;
        const first = new EventTarget();
        reloadOnStaleChunk({ target: first, storage, reload: () => reloads++, build: '/assets/index-a.js' });
        first.dispatchEvent(preloadError());
        const second = new EventTarget();
        reloadOnStaleChunk({ target: second, storage, reload: () => reloads++, build: '/assets/index-b.js' });
        second.dispatchEvent(preloadError());
        second.dispatchEvent(preloadError());
        expect(reloads).toBe(2);
    });

    test('never reloads when the flag cannot be kept', () => {
        const target = new EventTarget();
        let reloads = 0;
        const storage = {
            getItem: () => null,
            setItem: () => {
                throw new Error('storage is disabled');
            }
        };
        reloadOnStaleChunk({ target, storage, reload: () => reloads++, build: '/assets/index-a.js' });
        target.dispatchEvent(preloadError());
        expect(reloads).toBe(0);
    });

    test('stops listening once disposed', () => {
        const target = new EventTarget();
        let reloads = 0;
        const stop = reloadOnStaleChunk({ target, storage: memoryStorage(), reload: () => reloads++, build: '/assets/index-a.js' });
        stop();
        target.dispatchEvent(preloadError());
        expect(reloads).toBe(0);
    });
});

const failedOpens = () => {
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
};

describe('a failed open beside a prefetch', () => {
    test('a chunk only a prefetch asked for does not reload', () => {
        const target = new EventTarget();
        let reloads = 0;
        reloadOnStaleChunk({ target, storage: memoryStorage(), reload: () => reloads++, build: '/assets/index-a.js', prefetching: () => true });
        target.dispatchEvent(preloadError());
        expect(reloads).toBe(0);
    });

    test('a surface a person opened reloads, even while a prefetch runs', () => {
        const target = new EventTarget();
        const opens = failedOpens();
        let reloads = 0;
        reloadOnStaleChunk({
            target,
            storage: memoryStorage(),
            reload: () => reloads++,
            build: '/assets/index-a.js',
            prefetching: () => true,
            failedOpens: [opens.subscribe]
        });
        target.dispatchEvent(preloadError());
        opens.fail();
        expect(reloads).toBe(1);
    });

    test('a failed open and its own preload error reload once', () => {
        const target = new EventTarget();
        const opens = failedOpens();
        let reloads = 0;
        reloadOnStaleChunk({ target, storage: memoryStorage(), reload: () => reloads++, build: '/assets/index-a.js', failedOpens: [opens.subscribe] });
        target.dispatchEvent(preloadError());
        opens.fail();
        expect(reloads).toBe(1);
    });

    test('disposing stops listening to every source of failed opens', () => {
        const app = failedOpens();
        const chat = failedOpens();
        const stop = reloadOnStaleChunk({
            target: new EventTarget(),
            storage: memoryStorage(),
            reload: () => undefined,
            build: '/assets/index-a.js',
            failedOpens: [app.subscribe, chat.subscribe]
        });
        expect(app.listening() + chat.listening()).toBe(2);
        stop();
        expect(app.listening() + chat.listening()).toBe(0);
    });
});
