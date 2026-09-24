import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { overlayWords } from './overlay-words.ts';

const CONFIG_SWIFT = resolve(import.meta.dir, '..', '..', '..', 'computer-use', 'Sources', 'ComputerUseCore', 'OverlayConfig.swift');

/* The keys the helper reads: its string properties, and the keys of the `labels` and `steps` tables. */
const helperKeys = async (): Promise<{ words: string[]; labels: string[]; steps: string[] }> => {
    const source = await readFile(CONFIG_SWIFT, 'utf8');
    const table = (name: string): string[] => {
        const body = source.match(new RegExp(`public var ${name}: \\[String: String\\] = \\[([^\\]]*)\\]`))?.[1] ?? '';
        return [...body.matchAll(/"(\w+)":/g)].map((match) => match[1]!).sort();
    };
    return {
        words: [...source.matchAll(/public var (\w+) = "/g)].map((match) => match[1]!).sort(),
        labels: table('labels'),
        steps: table('steps')
    };
};

describe('the words of the overlay', () => {
    test('cover every key the helper reads, in both languages', async () => {
        const keys = await helperKeys();
        expect(keys.words.length).toBeGreaterThan(0);
        for (const language of ['en', 'nl']) {
            const { labels, steps, ...words } = overlayWords(language);
            expect(Object.keys(words).sort()).toEqual(keys.words);
            expect(Object.keys(labels).sort()).toEqual(keys.labels);
            expect(Object.keys(steps).sort()).toEqual(keys.steps);
        }
    });

    test('keep the English the helper falls back to', async () => {
        const source = await readFile(CONFIG_SWIFT, 'utf8');
        const english = overlayWords('en');
        for (const [key, value] of Object.entries({ ...english.labels, ...english.steps })) {
            expect(source).toContain(`"${key}": "${value}"`);
        }
        expect(source).toContain(`public var title = "${english.title}"`);
    });
});
