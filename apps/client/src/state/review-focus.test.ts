import { afterEach, describe, expect, test } from 'bun:test';
import { readOnlyChanges, useReviewFocus } from './review-focus.ts';

describe('whether a review hides the lines no change is near', () => {
    const previousStorage = globalThis.localStorage;
    const items = new Map<string, string>();

    function stubStorage(): void {
        globalThis.localStorage = {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => items.set(key, value)
        } as unknown as Storage;
    }

    afterEach(() => {
        globalThis.localStorage = previousStorage;
        items.clear();
        useReviewFocus.setState({ onlyChanges: false });
    });

    test('shows every line until a person chooses otherwise', () => {
        stubStorage();
        expect(readOnlyChanges()).toBe(false);
    });

    test('keeps the choice for the next page, and can be undone', () => {
        stubStorage();
        useReviewFocus.getState().setOnlyChanges(true);
        expect(useReviewFocus.getState().onlyChanges).toBe(true);
        expect(readOnlyChanges()).toBe(true);
        useReviewFocus.getState().setOnlyChanges(false);
        expect(readOnlyChanges()).toBe(false);
    });
});
