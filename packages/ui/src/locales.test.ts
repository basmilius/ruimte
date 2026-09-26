import { describe, expect, test } from 'bun:test';
import en from './locales/en.json';
import nl from './locales/nl.json';

const keysOf = (value: unknown, prefix = ''): string[] => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return [prefix];
    }
    return Object.entries(value).flatMap(([key, child]) => keysOf(child, prefix === '' ? key : `${prefix}.${key}`));
};

describe('the words of @ruimte/ui', () => {
    test('Dutch has every key English has, and no other', () => {
        expect(keysOf(nl).sort()).toEqual(keysOf(en).sort());
    });
});
