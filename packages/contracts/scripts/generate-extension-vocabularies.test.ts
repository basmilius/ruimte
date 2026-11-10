import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { errorCodesOf, render, slotNamesOf } from './generate-extension-vocabularies.ts';

const EXTENSION = join(import.meta.dir, '../../extension');
const client = readFileSync(join(EXTENSION, 'client.d.ts'), 'utf8');
const server = readFileSync(join(EXTENSION, 'server.d.ts'), 'utf8');

describe('the vocabularies read from the .d.ts of @ruimte/extension', () => {
    test('name the same error codes on both sides', () => {
        expect(errorCodesOf(client).length).toBeGreaterThan(5);
        expect(errorCodesOf(server)).toEqual(errorCodesOf(client));
    });

    test('name each slot once', () => {
        const slots = slotNamesOf(client);

        expect(slots.length).toBeGreaterThan(30);
        expect(new Set(slots).size).toBe(slots.length);
    });

    test('are what the generated file holds', () => {
        expect(readFileSync(join(import.meta.dir, '../src/extension-vocabularies.generated.ts'), 'utf8')).toBe(
            render(errorCodesOf(client), slotNamesOf(client))
        );
    });
});
