import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXTENSION_ERROR_CODES, extensionErrorCodeOf } from './extension-results.ts';

/* The codes `ExtensionErrorCode` lists in a `.d.ts` of `@ruimte/extension`, in order. */
function publicCodes(module: string): string[] {
    const source = readFileSync(join(import.meta.dir, '../../extension', `${module}.d.ts`), 'utf8');
    const union = /export type ExtensionErrorCode =([^;]+);/.exec(source)?.[1] ?? '';

    return [...union.matchAll(/'([a-z-]+)'/g)].map((match) => match[1] ?? '');
}

describe('the error codes of an extension', () => {
    test('are the ones `@ruimte/extension` promises, on both sides', () => {
        expect(publicCodes('client')).toEqual([...EXTENSION_ERROR_CODES]);
        expect(publicCodes('server')).toEqual([...EXTENSION_ERROR_CODES]);
    });

    test.each([
        ['forbidden', 'permission-denied'],
        ['not-connected', 'unavailable'],
        ['timeout', 'timeout'],
        ['no-launch', 'not-found'],
        ['unreadable', 'not-found'],
        ['outside-folder', 'outside-project'],
        ['internal', 'failed'],
        ['confirmation-declined', 'refused'],
        ['limit', 'limit']
    ])('read %s as %s', (code, expected) => {
        expect(extensionErrorCodeOf(code)).toBe(expected as (typeof EXTENSION_ERROR_CODES)[number]);
    });
});
