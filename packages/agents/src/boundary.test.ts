import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';
import { describe, expect, test } from 'bun:test';

const HERE = new URL('.', import.meta.url).pathname;

const sources = (): { path: string; text: string }[] =>
    [...new Glob('**/*.ts').scanSync(HERE)].map((path) => ({ path, text: readFileSync(join(HERE, path), 'utf8') }));

const isTest = (path: string): boolean => path.endsWith('.test.ts');

describe('the boundary of @ruimte/agents', () => {
    test('nothing imports from an app or from contracts beyond the chat host', () => {
        const reaching = sources()
            .filter(({ text }) => /from '@\/|from '(\.\.\/)+(apps|\.\.)|from '@ruimte\/contracts'/.test(text))
            .map(({ path }) => path);
        expect(reaching).toEqual([]);
    });

    // The package runs in Electron's Node as well; a test may still lean on Bun.
    test('nothing outside a test uses a Bun API', () => {
        const bunned = sources()
            .filter(({ path, text }) => !isTest(path) && /\bBun\.|from 'bun'|from "bun"/.test(text))
            .map(({ path }) => path);
        expect(bunned).toEqual([]);
    });
});
