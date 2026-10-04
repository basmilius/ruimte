import { describe, expect, test } from 'bun:test';
import { decodeSemanticTokens, scopesOf } from './semantic-model';

const legend = { tokenTypes: ['class', 'function', 'variable', 'keyword'], tokenModifiers: ['declaration', 'readonly', 'defaultLibrary'] };

describe('decodeSemanticTokens', () => {
    test('reads positions relative to the token before, and leaves out what the grammar does better', () => {
        // line 0: `class` at 6 (declaration), a keyword at 0, then line 2: a call at 4, a readonly variable at 12.
        const data = [0, 0, 5, 3, 0, 0, 6, 3, 0, 1, 2, 4, 4, 1, 0, 0, 8, 6, 2, 2];
        expect(decodeSemanticTokens({ data }, legend)).toEqual([
            { line: 0, character: 6, length: 3, scopes: ['entity.name.type.class'] },
            { line: 2, character: 4, length: 4, scopes: ['meta.function-call', 'entity.name.function'] },
            { line: 2, character: 12, length: 6, scopes: ['variable.other.constant'] }
        ]);
    });

    test('ignores a type the legend does not have', () => {
        expect(decodeSemanticTokens({ data: [0, 0, 3, 9, 0] }, legend)).toEqual([]);
    });
});

describe('scopesOf', () => {
    test('tells a declared function from a called one and a library one', () => {
        expect(scopesOf('function', new Set(['declaration']))).toEqual(['entity.name.function']);
        expect(scopesOf('method', new Set())).toEqual(['meta.function-call', 'entity.name.function']);
        expect(scopesOf('function', new Set(['defaultLibrary']))).toEqual(['support.function']);
        expect(scopesOf('variable', new Set())).toBeNull();
    });
});
