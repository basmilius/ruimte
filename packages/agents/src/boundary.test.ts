import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { Glob } from 'bun';
import { describe, expect, test } from 'bun:test';

const HERE = new URL('.', import.meta.url).pathname;

// This file is left out: its samples below name modules on purpose.
const sources = (): { path: string; text: string }[] =>
    [...new Glob('**/*.ts').scanSync(HERE)]
        .filter((path) => path !== 'boundary.test.ts')
        .map((path) => ({ path, text: readFileSync(join(HERE, path), 'utf8') }));

const isTest = (path: string): boolean => path.endsWith('.test.ts');

/* Every module a file names: an import or export from it, an import for its effect, a dynamic import and a require, in either quote. */
const modulesOf = (text: string): string[] =>
    [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])([^'"]+)\1/gm)].map((match) => match[2]!);

const reachesOut = (path: string, specifier: string): boolean =>
    specifier.startsWith('@/') ||
    specifier === '@ruimte/contracts' ||
    specifier.startsWith('@ruimte/contracts/') ||
    (specifier.startsWith('.') && relative(HERE, resolve(dirname(join(HERE, path)), specifier)).startsWith('..'));

const usesBun = (text: string): boolean => /\bBun\./.test(text) || modulesOf(text).some((specifier) => specifier === 'bun' || specifier.startsWith('bun:'));

describe('the boundary of @ruimte/agents', () => {
    test('nothing imports from an app or from contracts beyond the chat host', () => {
        const reaching = sources()
            .filter(({ path, text }) => modulesOf(text).some((specifier) => reachesOut(path, specifier)))
            .map(({ path }) => path);
        expect(reaching).toEqual([]);
    });

    // The package runs in Electron's Node as well; a test may still lean on Bun.
    test('nothing outside a test uses a Bun API', () => {
        const bunned = sources()
            .filter(({ path, text }) => !isTest(path) && usesBun(text))
            .map(({ path }) => path);
        expect(bunned).toEqual([]);
    });

    test('the checks see every way a file names a module', () => {
        expect(modulesOf(`import type { A } from "@ruimte/contracts";\nimport './side-effect.ts';\nexport { B } from '../../apps/x';`)).toEqual([
            '@ruimte/contracts',
            './side-effect.ts',
            '../../apps/x'
        ]);
        expect(modulesOf(`const db = await import('bun:sqlite');\nconst fs = require("node:fs");`)).toEqual(['bun:sqlite', 'node:fs']);
        expect(reachesOut('chat/chat-core.ts', '../../../apps/server/src/x.ts')).toBe(true);
        expect(reachesOut('chat/chat-core.ts', '../events.ts')).toBe(false);
        expect(usesBun(`import { Database } from "bun:sqlite";`)).toBe(true);
        expect(usesBun(`const { serve } = await import('bun');`)).toBe(true);
        expect(usesBun(`import { readFile } from 'node:fs/promises';`)).toBe(false);
    });
});
