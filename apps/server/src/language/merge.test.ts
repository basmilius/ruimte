import { describe, expect, it } from 'bun:test';
import { mergeAnswers, mergeProviders } from './merge.ts';

describe('merging the answers of several servers', () => {
    it('concatenates suggestions in server order, says which server made each, and is incomplete when one list is', () => {
        const merged = mergeAnswers('textDocument/completion', [
            { server: 'typescript', result: [{ label: 'a' }] },
            { server: 'tailwind', result: { isIncomplete: true, items: [{ label: 'b' }, { label: 'c' }] } },
            { server: 'eslint', result: null }
        ]);
        expect(merged.result).toEqual({ isIncomplete: true, items: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] });
        expect(merged.itemServers).toEqual(['typescript', 'tailwind', 'tailwind']);
    });

    it('concatenates the actions, and is no answer when none had one', () => {
        expect(
            mergeAnswers('textDocument/codeAction', [
                { server: 'typescript', result: [{ title: 'Fix import' }] },
                { server: 'eslint', result: [{ title: 'Fix semi' }] }
            ])
        ).toEqual({ result: [{ title: 'Fix import' }, { title: 'Fix semi' }], itemServers: ['typescript', 'eslint'] });
        expect(
            mergeAnswers('textDocument/codeAction', [
                { server: 'typescript', result: null },
                { server: 'eslint', result: null }
            ]).result
        ).toBeNull();
    });

    it('puts the hovers of the servers one under the other as marked strings, with the first range', () => {
        const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } };
        const merged = mergeAnswers('textDocument/hover', [
            { server: 'typescript', result: { contents: { kind: 'markdown', value: 'const a: number' }, range } },
            { server: 'css', result: null },
            { server: 'tailwind', result: { contents: { language: 'css', value: '.flex {}' } } }
        ]);
        expect(merged.result).toEqual({ contents: ['const a: number', { language: 'css', value: '.flex {}' }], range });
        expect(mergeAnswers('textDocument/hover', [{ server: 'css', result: null }]).result).toBeNull();
    });
});

describe('merging what the servers offer', () => {
    it('takes the first options of a feature that does not add up, and widens the ones that do', () => {
        const merged = mergeProviders([
            {
                'textDocument/definition': {},
                'textDocument/completion': { triggerCharacters: ['.'], resolveProvider: false },
                'textDocument/codeAction': { codeActionKinds: ['quickfix'] }
            },
            {
                'textDocument/definition': { other: true },
                'textDocument/completion': { triggerCharacters: ['.', '"'], resolveProvider: true },
                'textDocument/codeAction': { codeActionKinds: ['source.fixAll'] },
                'workspace/symbol': {}
            }
        ]);
        expect(merged['textDocument/definition']).toEqual({});
        expect(merged['textDocument/completion']).toEqual({ triggerCharacters: ['.', '"'], resolveProvider: true });
        expect(merged['textDocument/codeAction']).toEqual({ codeActionKinds: ['quickfix', 'source.fixAll'] });
        expect(merged['workspace/symbol']).toEqual({});
    });
});
