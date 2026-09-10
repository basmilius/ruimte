import { describe, expect, test } from 'bun:test';
import { fileIconFor } from './file-icon.ts';

describe('fileIconFor', () => {
    test('picks the icon of the file type', () => {
        expect(fileIconFor('apps/client/src/main.tsx')).toEqual({ symbol: 'file-tree-builtin-react', hue: 'cyan' });
        expect(fileIconFor('state/files.ts')).toEqual({ symbol: 'file-tree-builtin-typescript', hue: 'blue' });
        expect(fileIconFor('styles.css')).toEqual({ symbol: 'file-tree-builtin-css', hue: 'indigo' });
        expect(fileIconFor('logo.png')).toEqual({ symbol: 'file-tree-builtin-image', hue: 'pink' });
    });

    test('reads the whole name before the extension', () => {
        expect(fileIconFor('package.json').symbol).toBe('file-tree-builtin-json');
        expect(fileIconFor('bun.lock').symbol).toBe('file-tree-builtin-bun');
    });

    test('gives a dotfile the icon of the tool it configures', () => {
        expect(fileIconFor('.gitignore')).toEqual({ symbol: 'file-tree-builtin-git', hue: 'vermilion' });
        expect(fileIconFor('.prettierrc').symbol).toBe('file-tree-builtin-prettier');
        expect(fileIconFor('.oxlintrc.json').symbol).toBe('file-tree-builtin-oxc');
    });

    /* The set has no folder glyph, so the tree marks a directory with its turning chevron instead.
       A path that ends in a separator is what the tree calls a directory. */
    test('falls back to the generic file icon for a directory', () => {
        expect(fileIconFor('apps/client/').symbol).toBe('file-tree-builtin-default');
    });

    test('falls back to the generic file icon for a type it does not know', () => {
        expect(fileIconFor('notes.qqq')).toEqual({ symbol: 'file-tree-builtin-default', hue: 'gray' });
        expect(fileIconFor('LICENSE').symbol).toBe('file-tree-builtin-default');
    });
});
