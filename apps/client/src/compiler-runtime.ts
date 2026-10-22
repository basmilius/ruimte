import * as runtime from 'react/compiler-runtime';

/*
 * What the React Compiler's output imports in place of `react/compiler-runtime` (`react-compiler.ts`
 * points it here). A compiled component keeps what it worked out until an input it can see changes,
 * and the words and formats a label helper reads off i18next are no such input: the interface used to
 * write them again on every redraw a language or region change caused. Each cache carries one slot
 * more, with the words it was filled under, and empties itself the first time it draws under others.
 */

const EMPTY = Symbol.for('react.memo_cache_sentinel');

const memoCache = (runtime as unknown as { c(size: number): unknown[] }).c;

let words = 0;

export function forgetMemoizedWords(): void {
    words += 1;
}

export function c(size: number): unknown[] {
    const cache = memoCache(size + 1);
    if (cache[size] !== words) {
        cache.fill(EMPTY, 0, size);
        cache[size] = words;
    }
    return cache;
}
