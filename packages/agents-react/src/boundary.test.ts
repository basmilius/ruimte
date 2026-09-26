import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Glob } from 'bun';
import { describe, expect, test } from 'bun:test';

const HERE = new URL('.', import.meta.url).pathname;

const sources = (): string[] => [...new Glob('**/*.{ts,tsx}').scanSync(HERE)];

/* Every module a file names, in a static import, an export or a lazy `import()`. */
const specifiersOf = (path: string): string[] =>
    [...readFileSync(join(HERE, path), 'utf8').matchAll(/(?:from\s+|import\s*\(\s*|^import\s+)'([^']+)'/gm)].map((match) => match[1]!);

describe('the boundary of @ruimte/agents-react', () => {
    test('nothing imports from an app', () => {
        const reaching = sources().flatMap((path) =>
            specifiersOf(path)
                .filter(
                    (specifier) => specifier.startsWith('@/') || (specifier.startsWith('.') && !resolve(dirname(join(HERE, path)), specifier).startsWith(HERE))
                )
                .map((specifier) => `${path}: ${specifier}`)
        );
        expect(reaching).toEqual([]);
    });

    test('nothing imports the wire of a daemon, only the contracts of a chat host', () => {
        const reaching = sources().filter((path) =>
            specifiersOf(path).some((specifier) => specifier === '@ruimte/contracts' || specifier.startsWith('@ruimte/contracts/'))
        );
        expect(reaching).toEqual([]);
    });

    test('every source file is exported under its own path', () => {
        const manifest = JSON.parse(readFileSync(join(HERE, '../package.json'), 'utf8')) as { exports: Record<string, string> };
        const exported = new Set(Object.values(manifest.exports));
        const missing = sources().filter((path) => !path.endsWith('.test.ts') && !exported.has(`./src/${path}`));
        expect(missing).toEqual([]);
    });
});
