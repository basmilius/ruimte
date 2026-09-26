import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { AGENTS_LOCALES, AGENTS_NAMESPACES } from './locales';

const HERE = new URL('.', import.meta.url).pathname;

const namespacesOn = (language: string): string[] =>
    readdirSync(join(HERE, 'locales', language))
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length))
        .sort();

const read = (language: string, namespace: string): unknown => JSON.parse(readFileSync(join(HERE, 'locales', language, `${namespace}.json`), 'utf8'));

const strings = (value: unknown, prefix = ''): Array<[string, string]> => {
    if (typeof value === 'string') {
        return [[prefix, value]];
    }
    if (typeof value !== 'object' || value === null) {
        return [[prefix, '']];
    }
    return Object.entries(value).flatMap(([key, child]) => strings(child, prefix === '' ? key : `${prefix}.${key}`));
};

const placeholders = (text: string): string[] => [...text.matchAll(/\{\{\s*(\w+)[^}]*\}\}/g)].map((match) => match[1]!).sort();

describe('the words of @ruimte/agents-react', () => {
    test('every namespace has a file in every language, and every file a namespace', () => {
        expect(Object.keys(AGENTS_LOCALES).sort()).toEqual(['en', 'nl']);
        for (const language of Object.keys(AGENTS_LOCALES)) {
            expect(namespacesOn(language)).toEqual([...AGENTS_NAMESPACES].sort());
        }
    });

    test.each([...AGENTS_NAMESPACES])('Dutch has every key of %s English has, with the same placeholders, and no other', (namespace) => {
        const english = new Map(strings(read('en', namespace)));
        const dutch = new Map(strings(read('nl', namespace)));
        expect([...dutch.keys()].sort()).toEqual([...english.keys()].sort());
        for (const [key, text] of english) {
            expect([key, placeholders(dutch.get(key) ?? '')]).toEqual([key, placeholders(text)]);
        }
    });

    test('a loader answers every namespace of its language', async () => {
        for (const load of Object.values(AGENTS_LOCALES)) {
            expect(Object.keys(await load()).sort()).toEqual([...AGENTS_NAMESPACES].sort());
        }
    });
});
