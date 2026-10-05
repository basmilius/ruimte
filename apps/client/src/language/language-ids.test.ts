import { describe, expect, test } from 'bun:test';
import type { LanguageServerStatus } from '@ruimte/contracts';
import { customLanguageIdOf, lspLanguageIdOf } from './language-ids';

function own(languages: string[], patterns: string[]): LanguageServerStatus {
    return { server: 'custom:a', state: 'stopped', version: '', documents: 0, name: 'Zig', languages, patterns };
}

describe('the language a file opens with', () => {
    test('knows the languages of the catalog by the highlighter id of the file', () => {
        expect(lspLanguageIdOf('css')).toBe('css');
        expect(lspLanguageIdOf('docker')).toBe('dockerfile');
        expect(lspLanguageIdOf('shellscript')).toBe('shellscript');
        expect(lspLanguageIdOf('zig')).toBeNull();
        expect(lspLanguageIdOf(undefined)).toBeNull();
    });

    test('is the language of a file a server of a person serves, or its own pattern', () => {
        const statuses = [{ server: 'typescript', state: 'ready', version: '1', documents: 0 } as LanguageServerStatus, own(['zig'], ['*.zon'])];
        expect(customLanguageIdOf(statuses, 'zig', 'src/main.zig')).toBe('zig');
        expect(customLanguageIdOf(statuses, 'ZIG', 'src/main.zig')).toBe('zig');
        expect(customLanguageIdOf(statuses, undefined, 'build.zon')).toBe('plaintext');
        expect(customLanguageIdOf(statuses, 'toml', 'build.zon')).toBe('toml');
        expect(customLanguageIdOf(statuses, 'toml', 'Cargo.toml')).toBeNull();
        expect(customLanguageIdOf([], 'zig', 'main.zig')).toBeNull();
    });
});
