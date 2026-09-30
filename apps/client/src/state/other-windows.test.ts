import { describe, expect, test } from 'bun:test';
import { followOtherWindows } from './other-windows';

/* A page that hears what other pages write, the way `window` does. */
const fakeTarget = () => {
    const listeners = new Set<(event: StorageEvent) => void>();
    return {
        addEventListener: (_type: string, listener: (event: StorageEvent) => void) => void listeners.add(listener),
        removeEventListener: (_type: string, listener: (event: StorageEvent) => void) => void listeners.delete(listener),
        write: (key: string | null) => listeners.forEach((listener) => listener({ key } as StorageEvent)),
        get size() {
            return listeners.size;
        }
    };
};

describe('followOtherWindows', () => {
    test('reads again when another window writes the key, and not for another key', () => {
        const target = fakeTarget();
        let reads = 0;
        followOtherWindows('ruimte.settings', () => reads++, target as unknown as Window);
        target.write('ruimte.theme');
        expect(reads).toBe(0);
        target.write('ruimte.settings');
        expect(reads).toBe(1);
    });

    test('reads again when the whole storage was cleared', () => {
        const target = fakeTarget();
        let reads = 0;
        followOtherWindows('ruimte.settings', () => reads++, target as unknown as Window);
        target.write(null);
        expect(reads).toBe(1);
    });

    test('stops listening when asked', () => {
        const target = fakeTarget();
        const stop = followOtherWindows('ruimte.settings', () => undefined, target as unknown as Window);
        expect(target.size).toBe(1);
        stop();
        expect(target.size).toBe(0);
    });

    test('does nothing where there is no page', () => {
        expect(() => followOtherWindows('ruimte.settings', () => undefined, null)()).not.toThrow();
    });
});
