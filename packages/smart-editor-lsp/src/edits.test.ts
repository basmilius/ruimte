import { describe, expect, it } from 'bun:test';
import { applyContentChanges, applyTextEdits, endPosition, minimalChange, offsetAt, planWorkspaceEdit, positionAt } from './edits.ts';
import { origin } from './test-transport.ts';

describe('positions', () => {
    it('counts lines at LF, CRLF and a lone CR, and characters in UTF-16 units', () => {
        const text = 'a\r\n🙂\rz\nend';
        expect(offsetAt(text, { line: 1, character: 2 })).toBe(5);
        expect(offsetAt(text, { line: 2, character: 1 })).toBe(7);
        expect(offsetAt(text, { line: 3, character: 3 })).toBe(11);
        expect(positionAt(text, 5)).toEqual({ line: 1, character: 2 });
        expect(positionAt(text, 7)).toEqual({ line: 2, character: 1 });
        expect(positionAt(text, 3)).toEqual({ line: 1, character: 0 });
        expect(endPosition(text)).toEqual({ line: 3, character: 3 });
        expect(endPosition('')).toEqual(origin);
        expect(endPosition('x\n')).toEqual({ line: 1, character: 0 });
    });

    it('rejects a position outside the text', () => {
        expect(() => offsetAt('abc', { line: 1, character: 0 })).toThrow('outside the document');
        expect(() => offsetAt('abc', { line: 0, character: 4 })).toThrow('outside the line');
        expect(() => offsetAt('abc', { line: -1, character: 0 })).toThrow('Invalid');
        expect(() => positionAt('abc', 4)).toThrow('outside');
    });
});

describe('content changes', () => {
    it('applies entries one after the other, each in the coordinates the last one left', () => {
        const text = applyContentChanges('one\ntwo', [
            { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } }, text: '2\n3' },
            { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } }, text: 'three' }
        ]);
        expect(text).toBe('one\n2\nthree');
        expect(applyContentChanges('x', [{ text: 'whole' }])).toBe('whole');
    });

    it('turns a text into another with the one range that differs', () => {
        expect(minimalChange('hello world', 'hello brave world')).toEqual({
            range: { start: { line: 0, character: 6 }, end: { line: 0, character: 6 } },
            text: 'brave '
        });
        expect(minimalChange('a\nb\nc', 'a\nc')).toEqual({ range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } }, text: '' });
        const before = 'aaa';
        const after = 'aaaa';
        expect(applyContentChanges(before, [minimalChange(before, after)])).toBe(after);
    });

    it('round-trips random edits through the minimal change', () => {
        const alphabet = ['a', 'b', '\n', '\r\n', '🙂', 'é', ' '];
        let seed = 7;
        const next = (limit: number): number => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed % limit;
        };
        const random = (): string => Array.from({ length: next(12) }, () => alphabet[next(alphabet.length)]).join('');
        for (let i = 0; i < 300; i++) {
            const before = random();
            const after = random();
            expect(applyContentChanges(before, [minimalChange(before, after)])).toBe(after);
        }
    });
});

describe('workspace edit planning', () => {
    it('applies simultaneous UTF-16 edits with CRLF and preserves insertion order', () => {
        expect(
            applyTextEdits('🙂\r\nworld', [
                { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }, newText: 'earth' },
                { range: { start: origin, end: { line: 0, character: 2 } }, newText: 'hello' }
            ])
        ).toBe('hello\r\nearth');
        expect(
            applyTextEdits('x', [
                { range: { start: origin, end: origin }, newText: 'a' },
                { range: { start: origin, end: origin }, newText: 'b' }
            ])
        ).toBe('abx');
    });

    it('rejects overlap, invalid ranges, version mismatches and unhandled file operations', () => {
        const edit = { range: { start: origin, end: { line: 0, character: 2 } }, newText: 'new' };
        expect(() => applyTextEdits('old', [edit, edit])).toThrow('overlap');
        expect(() => applyTextEdits('x', [edit])).toThrow('outside');
        const snapshots = new Map([['file:///a', { text: 'old', version: 3 }]]);
        expect(() => planWorkspaceEdit({ documentChanges: [{ textDocument: { uri: 'file:///a', version: 2 }, edits: [edit] }] }, snapshots)).toThrow(
            'version mismatch'
        );
        expect(() => planWorkspaceEdit({ documentChanges: [{ kind: 'delete', uri: 'file:///a' }] }, snapshots)).toThrow('file-operation handler');
        expect(snapshots.get('file:///a')?.text).toBe('old');
    });

    it('validates every target before exposing a multi-file edit plan', () => {
        const edit = { range: { start: origin, end: { line: 0, character: 3 } }, newText: 'new' };
        const snapshots = new Map([['file:///a', { text: 'old', version: 3 }]]);
        expect(() => planWorkspaceEdit({ changes: { 'file:///a': [edit], 'file:///missing': [edit] } }, snapshots)).toThrow('Missing workspace snapshot');
        expect(snapshots.get('file:///a')?.text).toBe('old');
        expect(planWorkspaceEdit({ changes: { 'file:///a': [edit] } }, snapshots)).toEqual([{ uri: 'file:///a', version: 3, before: 'old', text: 'new' }]);
    });
});
