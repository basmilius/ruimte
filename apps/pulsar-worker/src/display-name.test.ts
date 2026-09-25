import { describe, expect, test } from 'bun:test';
import { appleUserName } from './apple.ts';
import { cleanDisplayName } from './display-name.ts';

describe('cleanDisplayName', () => {
    test('folds whitespace and control characters, and an empty name is none', () => {
        expect(cleanDisplayName('  Ada\n\u0000Lovelace  ')).toBe('Ada Lovelace');
        expect(cleanDisplayName(' \t ')).toBeNull();
        expect(cleanDisplayName(42)).toBeNull();
        expect(cleanDisplayName(null)).toBeNull();
    });

    test('caps a name at a hundred characters without splitting one', () => {
        expect(cleanDisplayName('a'.repeat(250))).toBe('a'.repeat(100));
        expect(Array.from(cleanDisplayName('😀'.repeat(150)) ?? '')).toHaveLength(100);
    });
});

describe('appleUserName', () => {
    test('joins the first and last name Apple posts', () => {
        expect(appleUserName(JSON.stringify({ name: { firstName: 'Bas', lastName: 'Milius' }, email: 'x@example.com' }))).toBe('Bas Milius');
        expect(appleUserName(JSON.stringify({ name: { firstName: 'Bas' } }))).toBe('Bas');
    });

    test('names nobody for a field that is missing or not what Apple sends', () => {
        for (const field of [null, '', 'not json', 'null', '[]', '{"name":"Bas"}', '{"name":{"firstName":7,"lastName":null}}']) {
            expect(appleUserName(field)).toBeNull();
        }
    });
});
