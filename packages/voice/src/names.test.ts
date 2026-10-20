import { describe, expect, test } from 'bun:test';
import { matchName, normalizedName, resolveNames } from './names.ts';

const targets = [
    { id: 'a', name: 'Chat Test' },
    { id: 'b', name: 'Chat Test Two' },
    { id: 'c', name: 'Café notes' }
];

describe('spoken names', () => {
    test('ignore accents, case and punctuation', () => {
        expect(normalizedName('  Café-Notes! ')).toBe('cafe notes');
        expect(matchName('cafe notes', targets)).toEqual({ status: 'found', value: targets[2]! });
    });

    test('an exact name wins over a partial one, and two partial ones are the person’s to choose', () => {
        expect(matchName('chat test', targets)).toEqual({ status: 'found', value: targets[0]! });
        expect(matchName('chat', targets)).toEqual({ status: 'ambiguous', candidates: [targets[0]!, targets[1]!] });
        expect(matchName('release', targets)).toEqual({ status: 'missing' });
        expect(matchName('!!', targets)).toEqual({ status: 'missing' });
    });

    test('every name resolves on its own, and a target two names found is found once', () => {
        expect(resolveNames(['chat test', 'Chat Test', 'chat', 'release'], (name) => matchName(name, targets))).toEqual({
            found: [targets[0]!],
            ambiguous: [{ name: 'chat', candidates: [targets[0]!, targets[1]!] }],
            missing: ['release']
        });
    });
});
