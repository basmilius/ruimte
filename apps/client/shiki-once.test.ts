import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { shikiModules, shippedFiles, shippedPath } from './shiki-once.ts';

describe('shiki once', () => {
    test('a grammar or a theme of a bundle points at the shared folder, anything else bundles as usual', () => {
        expect(shippedPath('@shikijs/langs/php', '4.4.3')).toBe('assets/shiki-4.4.3/langs/php.mjs');
        expect(shippedPath('@shikijs/langs/objective-c', '4.4.3')).toBe('assets/shiki-4.4.3/langs/objective-c.mjs');
        expect(shippedPath('@shikijs/themes/github-dark', '4.4.3')).toBe('assets/shiki-4.4.3/themes/github-dark.mjs');
        expect(shippedPath('@shikijs/engine-oniguruma/wasm-inlined', '4.4.3')).toBe('assets/shiki-4.4.3/wasm.mjs');
        expect(shippedPath('@shikijs/langs', '4.4.3')).toBeNull();
        expect(shippedPath('@shikijs/core', '4.4.3')).toBeNull();
        expect(shippedPath('shiki/bundle/web', '4.4.3')).toBeNull();
    });

    test('a folder ships its modules without the index or the types', () => {
        expect(shippedFiles(['index.mjs', 'index.d.mts', 'php.mjs', 'php.d.mts', 'html.mjs'])).toEqual(['php.mjs', 'html.mjs']);
    });

    test('the folders are the ones the installed shiki imports from', () => {
        const { folders, version, wasm } = shikiModules();
        expect(version).toMatch(/^\d+\.\d+\.\d+/);
        expect(existsSync(join(folders.langs, 'php.mjs'))).toBe(true);
        expect(existsSync(join(folders.themes, 'nord.mjs'))).toBe(true);
        expect(typeof wasm).toBe('string');
        expect(existsSync(wasm)).toBe(true);
    });
});
