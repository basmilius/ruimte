import { describe, expect, test } from 'bun:test';
import { allFilesLabel, databaseSecretFile, openDialogPlan, parseOpenPathRequest, parseSavePathRequest, parseSecret, parseSecretKey } from './database-bridge';

describe('database secrets', () => {
    test('a key is a short string and a secret a string or null', () => {
        expect(parseSecretKey('local/project/connection')).toBe('local/project/connection');
        expect(() => parseSecretKey('')).toThrow();
        expect(() => parseSecretKey(42)).toThrow();
        expect(() => parseSecretKey('x'.repeat(513))).toThrow();
        expect(parseSecret('hunter2')).toBe('hunter2');
        expect(parseSecret(null)).toBeNull();
        expect(() => parseSecret(undefined)).toThrow();
        expect(() => parseSecret({ password: 'x' })).toThrow();
    });

    test('names the file after a hash of the key, so a key never names a path', () => {
        const file = databaseSecretFile('/data/database-secrets', '../../etc/passwd');
        expect(file).toMatch(/^\/data\/database-secrets\/[0-9a-f]{64}\.bin$/);
        expect(databaseSecretFile('/data', 'a')).toBe(databaseSecretFile('/data', 'a'));
        expect(databaseSecretFile('/data', 'a')).not.toBe(databaseSecretFile('/data', 'b'));
    });
});

describe('database file dialogs', () => {
    test('takes only a purpose it knows and extensions without a dot', () => {
        expect(parseOpenPathRequest({ purpose: 'import', extensions: ['csv', 'tsv'] })).toEqual({ purpose: 'import', extensions: ['csv', 'tsv'] });
        expect(parseOpenPathRequest({ purpose: 'identity' })).toEqual({ purpose: 'identity', extensions: [] });
        expect(() => parseOpenPathRequest({ purpose: 'anything' })).toThrow();
        expect(() => parseOpenPathRequest({ purpose: 'import', extensions: ['.csv'] })).toThrow();
        expect(() => parseOpenPathRequest(null)).toThrow();
    });

    test('suggests a file name, never a path', () => {
        expect(parseSavePathRequest({ suggestedName: 'orders.csv', extension: 'csv' })).toEqual({ suggestedName: 'orders.csv', extension: 'csv' });
        expect(() => parseSavePathRequest({ suggestedName: '../orders.csv', extension: 'csv' })).toThrow();
        expect(() => parseSavePathRequest({ suggestedName: 'orders.csv', extension: 'c/v' })).toThrow();
        expect(() => parseSavePathRequest({ suggestedName: '', extension: 'csv' })).toThrow();
    });

    test('opens an SSH key in ~/.ssh with hidden files shown', () => {
        expect(openDialogPlan({ purpose: 'identity' }, '/Users/me', 'All files')).toEqual({
            filters: [],
            defaultPath: '/Users/me/.ssh',
            showHiddenFiles: true
        });
    });

    test('filters a database on SQLite and an import on its formats, with every file last', () => {
        expect(openDialogPlan({ purpose: 'database' }, '/Users/me', 'All files').filters.at(-1)).toEqual({ name: 'All files', extensions: ['*'] });
        expect(openDialogPlan({ purpose: 'import', extensions: ['csv', 'tsv'] }, '/Users/me', 'All files').filters).toEqual([
            { name: 'CSV, TSV', extensions: ['csv', 'tsv'] },
            { name: 'All files', extensions: ['*'] }
        ]);
    });

    test('names every file in the language of the interface', () => {
        expect(allFilesLabel('nl')).toBe('Alle bestanden');
        expect(allFilesLabel('en')).toBe('All files');
        expect(allFilesLabel(undefined)).toBe('All files');
    });
});
