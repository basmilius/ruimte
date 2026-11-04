import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { memoryStorage } from '../../testing/memory-storage';
import { storedJson, storedText, type KeyValueStorage } from './stored-json';

const refusing: KeyValueStorage = {
    getItem: () => {
        throw new Error('denied');
    },
    setItem: () => {
        throw new Error('denied');
    },
    removeItem: () => {
        throw new Error('denied');
    }
};

describe('storedJson', () => {
    const stored = storedJson('ruimte.test', z.object({ count: z.number() }));

    test('writes plain JSON and reads it back', () => {
        const storage = memoryStorage();
        expect(stored.write({ count: 3 }, storage)).toBe(true);
        expect(storage.values.get('ruimte.test')).toBe('{"count":3}');
        expect(stored.read(storage)).toEqual({ count: 3 });
    });

    test('reads nothing for a missing key, text that is no JSON, or JSON that does not fit', () => {
        const storage = memoryStorage();
        expect(stored.read(storage)).toBeNull();
        storage.setItem('ruimte.test', '{ not json');
        expect(stored.read(storage)).toBeNull();
        storage.setItem('ruimte.test', '{"count":"three"}');
        expect(stored.read(storage)).toBeNull();
    });

    test('a schema may keep what fits and drop the rest', () => {
        const storage = memoryStorage();
        const strings = storedJson(
            'ruimte.strings',
            z.array(z.unknown()).transform((items) => items.filter((item) => typeof item === 'string'))
        );
        storage.setItem('ruimte.strings', '["a",1,"b"]');
        expect(strings.read(storage)).toEqual(['a', 'b']);
    });

    test('removes the key', () => {
        const storage = memoryStorage();
        stored.write({ count: 1 }, storage);
        stored.remove(storage);
        expect(storage.values.has('ruimte.test')).toBe(false);
    });

    test('survives a storage that refuses', () => {
        expect(stored.read(refusing)).toBeNull();
        expect(stored.write({ count: 1 }, refusing)).toBe(false);
        expect(() => stored.remove(refusing)).not.toThrow();
        expect(stored.read(null)).toBeNull();
        expect(stored.write({ count: 1 }, null)).toBe(false);
    });
});

describe('storedText', () => {
    test('keeps the string as it is', () => {
        const storage = memoryStorage();
        const text = storedText('ruimte.text');
        expect(text.write('closed', storage)).toBe(true);
        expect(storage.values.get('ruimte.text')).toBe('closed');
        expect(text.read(storage)).toBe('closed');
        expect(text.read(refusing)).toBeNull();
    });
});

const SOURCES = fileURLToPath(new URL('..', import.meta.url));

function sourcesIn(folder: string): string[] {
    return readdirSync(folder).flatMap((name) => {
        const path = join(folder, name);
        if (statSync(path).isDirectory()) {
            return sourcesIn(path);
        }
        return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
}

describe('the browser storage', () => {
    test('is read and written only through stored-json', () => {
        const sources = sourcesIn(SOURCES).map((path) => relative(SOURCES, path).split(sep).join('/'));
        expect(sources).toContain('state/stored-json.ts');
        const direct = sources
            .filter((path) => path !== 'state/stored-json.ts')
            .filter((path) => /localStorage\.(getItem|setItem|removeItem|clear)\(/.test(readFileSync(join(SOURCES, path), 'utf8')));
        expect(direct).toEqual([]);
    });
});
