import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';
import { describe, expect, test } from 'bun:test';

const HERE = new URL('.', import.meta.url).pathname;

const sources = (): string[] => [...new Glob('**/*.{ts,tsx}').scanSync(HERE)];

describe('the boundary of @ruimte/agents-react', () => {
    test('nothing imports from an app', () => {
        const reaching = sources().filter((path) => /from '@\/|from '(\.\.\/)+(apps|\.\.)/.test(readFileSync(join(HERE, path), 'utf8')));
        expect(reaching).toEqual([]);
    });

    test('nothing imports the wire of a daemon, only the contracts of a chat host', () => {
        const reaching = sources().filter((path) => /from '@ruimte\/contracts['/]/.test(readFileSync(join(HERE, path), 'utf8')));
        expect(reaching).toEqual([]);
    });

    test('every source file is exported under its own path', () => {
        const manifest = JSON.parse(readFileSync(join(HERE, '../package.json'), 'utf8')) as { exports: Record<string, string> };
        const exported = new Set(Object.values(manifest.exports));
        const missing = sources().filter((path) => !path.endsWith('.test.ts') && !exported.has(`./src/${path}`));
        expect(missing).toEqual([]);
    });
});
