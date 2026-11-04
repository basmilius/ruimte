import { afterEach, describe, expect, test } from 'bun:test';
import { defineBuiltIn } from '@/extensions/internal';
import { startSharedStorage } from '@/state/shared-storage';

const DISABLED_KEY = 'ruimte.builtIns.disabled';
const address = window.location.href;

afterEach(() => {
    window.history.replaceState(null, '', address);
    localStorage.removeItem(DISABLED_KEY);
});

/* A built-in that counts what its setup added and what was taken out again. */
function counted(id: string): { added: number; removed: number } {
    const count = { added: 0, removed: 0 };

    defineBuiltIn({ id, name: id, version: '1.0.0', api: 1 }, () => {
        count.added += 1;

        return [() => (count.removed += 1)];
    });

    return count;
}

describe('a built-in', () => {
    test('runs no setup in safe mode', () => {
        window.history.replaceState(null, '', '?safe-mode');

        expect(counted('acme.safe')).toEqual({ added: 0, removed: 0 });
    });

    test('follows another window that turns it off and on, without writing the list back', () => {
        const stop = startSharedStorage();
        const count = counted('acme.followed');
        const otherWindow = (disabled: string[]): void => {
            localStorage.setItem(DISABLED_KEY, JSON.stringify(disabled));
            window.dispatchEvent(new StorageEvent('storage', { key: DISABLED_KEY }));
        };

        otherWindow(['acme.followed']);

        const off = { ...count };

        otherWindow([]);
        stop();

        expect(off).toEqual({ added: 1, removed: 1 });
        expect(count).toEqual({ added: 2, removed: 1 });
        expect(localStorage.getItem(DISABLED_KEY)).toBe('[]');
    });
});
