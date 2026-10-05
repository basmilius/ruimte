import { describe, expect, test } from 'bun:test';
import { type CodeFolding, codeFoldingFrom, DEFAULT_CODE_FOLDING, foldRolesFor } from './code-folding';

describe('code folding settings', () => {
    test('read as the platform defaults for a client that stored nothing', () => {
        expect(codeFoldingFrom(undefined)).toEqual(DEFAULT_CODE_FOLDING);
        expect(codeFoldingFrom('nonsense')).toEqual(DEFAULT_CODE_FOLDING);
    });

    test('keep a stored switch and ignore what is not one', () => {
        const folding = codeFoldingFrom({ imports: false, methodBodies: true, docComments: 'yes', unknown: true });
        expect(folding.imports).toBe(false);
        expect(folding.methodBodies).toBe(true);
        expect(folding.docComments).toBe(false);
        expect(folding).not.toHaveProperty('unknown');
    });
});

describe('the roles that fold for a language', () => {
    test('are the header and the imports by default, and the front matter of Markdown', () => {
        expect(foldRolesFor('typescript', DEFAULT_CODE_FOLDING)).toEqual(['file-header', 'imports']);
        expect(foldRolesFor(undefined, DEFAULT_CODE_FOLDING)).toEqual(['file-header', 'imports']);
        expect(foldRolesFor('markdown', DEFAULT_CODE_FOLDING)).toEqual(['file-header', 'imports', 'front-matter']);
    });

    test('take the general method bodies everywhere but PHP, which has its own', () => {
        const folding = { ...DEFAULT_CODE_FOLDING, methodBodies: true, phpClassBodies: true, phpFunctionBodies: true };
        expect(foldRolesFor('python', folding)).toEqual(['file-header', 'imports', 'function-body', 'method-body']);
        expect(foldRolesFor('php', folding)).toEqual(['file-header', 'imports', 'function-body', 'class-body']);
    });

    test('add only what a language has', () => {
        const everything = { ...DEFAULT_CODE_FOLDING };
        for (const name of Object.keys(everything) as (keyof CodeFolding)[]) {
            everything[name] = true;
        }
        expect(foldRolesFor('tsx', everything)).toEqual([
            'file-header',
            'imports',
            'doc-comment',
            'region',
            'function-body',
            'method-body',
            'object-literal',
            'array-literal',
            'tag'
        ]);
        expect(foldRolesFor('html', everything)).toEqual(['file-header', 'imports', 'doc-comment', 'region', 'function-body', 'method-body', 'tag']);
        expect(foldRolesFor('php', everything)).toContain('php-tag');
        expect(foldRolesFor('php', everything)).not.toContain('object-literal');
        expect(foldRolesFor('markdown', everything)).toContain('table');
    });
});
