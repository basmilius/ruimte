import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';
import { describe, expect, test } from 'bun:test';

const HERE = new URL('.', import.meta.url).pathname;

describe('the boundary of @ruimte/ui', () => {
    test('nothing imports from an app', () => {
        const reaching = [...new Glob('**/*.{ts,tsx}').scanSync(HERE)].filter((path) =>
            /from '@\/|from '(\.\.\/)+(apps|\.\.)/.test(readFileSync(join(HERE, path), 'utf8'))
        );
        expect(reaching).toEqual([]);
    });
});
