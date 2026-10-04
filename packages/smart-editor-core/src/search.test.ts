import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';

describe('find and replace', () => {
    it('finds literals with Unicode whole-word boundaries, bounds and case options', () => {
        const model = new DocumentModel('Cat cat cats concatenate cat_ cat😀 \u{10400}cat cat\u0301');
        expect(model.find('cat')).toHaveLength(8);
        expect(model.find('cat', { wholeWord: true }).map((match) => match.from)).toEqual([0, 4, 30]);
        expect(model.find('cat', { caseSensitive: true, wholeWord: true }).map((match) => match.from)).toEqual([4, 30]);
        expect(model.find('cat', { from: 4, to: 7 })).toMatchObject([{ from: 4, to: 7, text: 'cat', revision: 0 }]);
        expect(model.find('cat', { maxResults: 2 })).toHaveLength(2);
        expect(model.find('cat', { maxResults: 0 })).toEqual([]);
        expect(model.find('')).toEqual([]);
        expect(() => model.find('cat', { from: -1 })).toThrow(RangeError);
        expect(() => model.find('cat', { maxResults: 1.5 })).toThrow(RangeError);
    });

    it('escapes literal regular-expression characters and wraps in both directions', () => {
        const model = new DocumentModel('a.b a?b a.b');
        expect(model.find('a.b', { caseSensitive: true }).map((match) => match.from)).toEqual([0, 8]);
        expect(model.findNext('a.b', 1)?.from).toBe(8);
        expect(model.findNext('a.b', 11)?.from).toBe(0);
        expect(model.findNext('a.b', 11, { wrap: false })).toBeNull();
        expect(model.findNext('a.b', 8, { backwards: true })?.from).toBe(0);
        expect(model.findNext('a.b', 0, { backwards: true })?.from).toBe(8);
        expect(model.findNext('absent')).toBeNull();
    });

    it('handles zero-width Unicode matches without a loop or a split surrogate', () => {
        const model = new DocumentModel('😀x\r\n😀');
        expect(model.find('(?=.)', { regex: true }).map((match) => match.from)).toEqual([0, 2, 5]);
        expect(model.find('', { regex: true }).map((match) => match.from)).toEqual([0, 2, 3, 4, 5, 7]);
        expect(model.find('\ud83d')).toEqual([]);
        expect(model.find('(?=.)', { regex: true, from: 1 }).map((match) => match.from)).toEqual([2, 5]);
        expect(model.replaceAll('(?=.)', '>', { regex: true })).toBe(3);
        expect(model.getText()).toBe('>😀>x\r\n>😀');
        model.undo();
        expect(model.getText()).toBe('😀x\r\n😀');
    });

    it('expands captures and named groups in one atomic replacement and preserves history', () => {
        const model = new DocumentModel('first=12\r\nsecond=3');
        model.setSelections([{ anchor: 8, head: 0 }]);
        expect(model.replaceAll('(?<key>\\w+)=(\\d+)', '$<key>:$2 $$ $&', { regex: true })).toBe(2);
        expect(model.getText()).toBe('first:12 $ first=12\r\nsecond:3 $ second=3');
        expect(model.getRevision()).toBe(1);
        model.undo();
        expect(model.getText()).toBe('first=12\r\nsecond=3');
        expect(model.getSelections()).toEqual([{ anchor: 8, head: 0 }]);
        model.redo();
        expect(model.getText()).toBe('first:12 $ first=12\r\nsecond:3 $ second=3');
    });

    it('supports literal replacements, unmatched captures and JavaScript replacement tokens', () => {
        const model = new DocumentModel('ab cd');
        const match = model.find('(a)(z)?b', { regex: true })[0]!;
        model.replace(match, '$2$10:$01:$0:$<none>');
        expect(model.getText()).toBe('a0:a:$0:$<none> cd');
        model.setText('abc');
        model.replace(model.find('b', { regex: true })[0]!, "$`-$&-$'");
        expect(model.getText()).toBe('aa-b-cc');
        model.setText('cat cat');
        model.replaceAll('cat', '$&');
        expect(model.getText()).toBe('$& $&');
        model.setText('cat cat');
        model.replaceAll('cat', '$&', { regex: true, literal: true });
        expect(model.getText()).toBe('$& $&');
    });

    it('rejects stale matches and replacement revisions and reports invalid expressions before editing', () => {
        const model = new DocumentModel('a a');
        const match = model.find('a')[0]!;
        model.typeText('!');
        expect(model.replace(match, 'x')).toBe(false);
        expect(model.replaceAll('a', 'x', { expectedRevision: 0 })).toBe(0);
        expect(() => model.replaceAll('[', 'x', { regex: true })).toThrow(SyntaxError);
        expect(model.getText()).toBe('!a a');
        expect(model.getRevision()).toBe(1);
        model.undo();
        expect(model.replace(match, 'x')).toBe(false);
        expect(model.replaceAll('a', 'a')).toBe(0);
        expect(model.getSnapshot().canRedo).toBe(true);
    });
});

describe('lexical and indentation folds', () => {
    it('derives nested multiline bracket and comment folds while ignoring quoted and commented braces', () => {
        const model = new DocumentModel('function x() {\r\n  const s = "}"; // {\r\n  [\r\n    1, 2\r\n  ]\r\n  /* {\r\n     } */\r\n}\r\n');
        const folds = model.getFoldingRanges();
        expect(folds.map(({ startLine, endLine, kind }) => ({ startLine, endLine, kind }))).toEqual([
            { startLine: 0, endLine: 7, kind: 'bracket' },
            { startLine: 2, endLine: 4, kind: 'bracket' },
            { startLine: 5, endLine: 6, kind: 'comment' }
        ]);
        expect(model.slice(folds[0]!.from, folds[0]!.to).startsWith('{')).toBe(true);
        expect(model.getFoldingRanges({ brackets: false }).map((fold) => fold.kind)).toEqual(['comment']);
        expect(model.getFoldingRanges({ minLines: 3 })).toHaveLength(1);
    });

    it('handles escaped strings and an unterminated comment without invented closing braces', () => {
        const model = new DocumentModel('{\n "\\\"}";\n /* unterminated }\n');
        expect(model.getFoldingRanges()).toEqual([]);
        model.setText('{\n `}\\` {`\n}');
        expect(model.getFoldingRanges()).toMatchObject([{ startLine: 0, endLine: 2 }]);
        model.undo();
        expect(model.getFoldingRanges()).toEqual([]);
    });

    it('derives indentation folds with visual tabs, blank lines and nested blocks', () => {
        const model = new DocumentModel('outer:\n\tfirst\n\tinner:\n\t\tchild\n\n\tlast\nnext\n');
        const folds = model.getFoldingRanges({ indentation: true, tabSize: 4 });
        expect(folds.map(({ startLine, endLine, kind }) => ({ startLine, endLine, kind }))).toEqual([
            { startLine: 0, endLine: 5, kind: 'indentation' },
            { startLine: 2, endLine: 3, kind: 'indentation' }
        ]);
        model.applyEdits([{ from: 0, to: 0, text: '\n' }]);
        expect(model.getFoldingRanges({ indentation: true })[0]!.startLine).toBe(1);
    });
});
