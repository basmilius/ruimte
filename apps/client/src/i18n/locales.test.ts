import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { APP_LANGUAGES, FALLBACK_LANGUAGE } from '@/i18n/languages';
import { NAMESPACES } from '@/i18n/namespaces';

const HERE = new URL('.', import.meta.url).pathname;
const localeDir = (language: string): string => join(HERE, 'locales', language);

const read = async (language: string, namespace: string): Promise<Record<string, unknown>> => {
    const file = Bun.file(join(localeDir(language), `${namespace}.json`));
    return (await file.json()) as Record<string, unknown>;
};

/* Every key a file holds, flattened, so two languages compare as two lists and not as two trees. */
const keysOf = (value: unknown, prefix = ''): string[] => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return [prefix];
    }
    return Object.entries(value).flatMap(([key, child]) => keysOf(child, prefix === '' ? key : `${prefix}.${key}`));
};

const strings = (value: unknown, prefix = ''): Array<[string, string]> => {
    if (typeof value === 'string') {
        return [[prefix, value]];
    }
    if (typeof value !== 'object' || value === null) {
        return [];
    }
    return Object.entries(value).flatMap(([key, child]) => strings(child, prefix === '' ? key : `${prefix}.${key}`));
};

/*
 * The keys an object in the file names twice. A parser keeps the last and drops the first without a
 * word, so a block of words disappears while the file still reads as valid.
 */
const repeatedKeys = (text: string): string[] => {
    const open: Array<Set<string>> = [];
    const repeated: string[] = [];
    // A whole string is one match, so a brace inside a value ("{{count}}") never opens an object.
    for (const match of text.matchAll(/"((?:[^"\\]|\\.)*)"(\s*:)?|[{}]/g)) {
        if (match[0] === '{') {
            open.push(new Set());
        } else if (match[0] === '}') {
            open.pop();
        } else if (match[2] !== undefined) {
            const keys = open.at(-1);
            const key = match[1]!;
            if (keys?.has(key)) {
                repeated.push(key);
            }
            keys?.add(key);
        }
    }
    return repeated;
};

const namespacesOn = (language: string): string[] =>
    readdirSync(localeDir(language))
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length))
        .sort();

describe('the translation files', () => {
    test('are named after a namespace the app knows', () => {
        for (const language of APP_LANGUAGES) {
            for (const namespace of namespacesOn(language)) {
                expect(NAMESPACES).toContain(namespace as (typeof NAMESPACES)[number]);
            }
        }
    });

    test('are the same set in every language', () => {
        const english = namespacesOn(FALLBACK_LANGUAGE);
        for (const language of APP_LANGUAGES) {
            expect(namespacesOn(language)).toEqual(english);
        }
    });

    /*
     * The one rule that keeps a half-translated screen out: a key that English has and another
     * language does not falls back and reads English in the middle of a Dutch sentence, and a key
     * only the other language has is a word nobody ever draws.
     */
    test('hold the same keys in every language', async () => {
        for (const namespace of namespacesOn(FALLBACK_LANGUAGE)) {
            const english = keysOf(await read(FALLBACK_LANGUAGE, namespace)).sort();
            for (const language of APP_LANGUAGES) {
                if (language === FALLBACK_LANGUAGE) {
                    continue;
                }
                expect({ namespace, language, keys: keysOf(await read(language, namespace)).sort() }).toEqual({ namespace, language, keys: english });
            }
        }
    });

    test('name every key once per object', async () => {
        for (const language of APP_LANGUAGES) {
            for (const namespace of namespacesOn(language)) {
                const text = await Bun.file(join(localeDir(language), `${namespace}.json`)).text();
                expect({ namespace, language, repeated: repeatedKeys(text) }).toEqual({ namespace, language, repeated: [] });
            }
        }
    });

    test('interpolate the same names on both sides', async () => {
        const placeholders = (value: string): string[] => [...value.matchAll(/\{\{(\w+)/g)].map((match) => match[1]!).sort();
        for (const namespace of namespacesOn(FALLBACK_LANGUAGE)) {
            const english = new Map(strings(await read(FALLBACK_LANGUAGE, namespace)));
            for (const language of APP_LANGUAGES) {
                if (language === FALLBACK_LANGUAGE) {
                    continue;
                }
                for (const [key, value] of strings(await read(language, namespace))) {
                    expect({ key, names: placeholders(value) }).toEqual({ key, names: placeholders(english.get(key) ?? '') });
                }
            }
        }
    });

    test('write an ellipsis as one character, never as three dots', async () => {
        for (const language of APP_LANGUAGES) {
            for (const namespace of namespacesOn(language)) {
                const dotted = strings(await read(language, namespace))
                    .filter(([, value]) => value.includes('...'))
                    .map(([key]) => key);
                expect({ namespace, language, dotted }).toEqual({ namespace, language, dotted: [] });
            }
        }
    });
});
