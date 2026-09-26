import { describe, expect, test } from 'bun:test';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { codeRanges, markdownLanguage } from './editor';

const stateOf = (doc: string): EditorState => {
    const state = EditorState.create({ doc, extensions: markdownLanguage });
    ensureSyntaxTree(state, doc.length, 5000);
    return state;
};

describe('codeRanges', () => {
    test('finds code spans and fenced blocks', () => {
        const state = stateOf('see `a` and\n```ts\nx\n```\nafter');
        expect(codeRanges(state)).toEqual([
            { from: 4, to: 7, kind: 'inline' },
            { from: 12, to: 23, kind: 'fence' }
        ]);
    });

    test('runs an unclosed fence to the end of the text', () => {
        const doc = 'look\n```\nconst a = 1;';
        expect(codeRanges(stateOf(doc))).toEqual([{ from: 5, to: doc.length, kind: 'fence' }]);
    });

    test('keeps to the range it is asked about', () => {
        const state = stateOf('`one` and `two`');
        expect(codeRanges(state, 6, 15)).toEqual([{ from: 10, to: 15, kind: 'inline' }]);
    });

    test('finds nothing in prose, bold or an unclosed backtick', () => {
        expect(codeRanges(stateOf('plain **bold** and `open'))).toEqual([]);
    });
});
