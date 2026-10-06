import { describe, expect, test } from 'bun:test';
import { REFACTOR_GROUPS, actionsOf, diagnosticsAt, fixableOnLine, groupOf, isHint, mergeEntries, previewOf } from '@adecore/editor-react/models';

const range = (line: number, start: number, end: number) => ({ start: { line, character: start }, end: { line, character: end } });
const uri = 'file:///work/a.ts';

describe('code action groups', () => {
    test('files the kinds that nest by dots under their parent', () => {
        expect(groupOf('quickfix')).toBe('quickfix');
        expect(groupOf('refactor.extract.function')).toBe('extract');
        expect(groupOf('refactor.inline')).toBe('inline');
        expect(groupOf('refactor.move')).toBe('move');
        expect(groupOf('refactor.rewrite.arrow')).toBe('rewrite');
        expect(groupOf('refactor')).toBe('refactor');
        expect(groupOf('refactor.surround')).toBe('refactor');
        expect(groupOf('refactor.extraction')).toBe('refactor');
        expect(groupOf('source.organizeImports')).toBe('source');
        expect(groupOf('sourceish')).toBe('other');
        expect(groupOf(undefined)).toBe('other');
    });

    test('lists quick fixes before refactors, preferred first, and leaves out what the server disabled', () => {
        const entries = actionsOf([
            { title: 'Extract', kind: 'refactor.extract' },
            { title: 'Second fix', kind: 'quickfix' },
            { title: 'Not here', kind: 'refactor', disabled: { reason: 'no selection' } },
            { title: 'Best fix', kind: 'quickfix', isPreferred: true },
            { title: 'Run', command: 'x.run' }
        ]);
        expect(entries.map((entry) => entry.action.title)).toEqual(['Best fix', 'Second fix', 'Extract', 'Run']);
        expect(entries.map((entry) => entry.group)).toEqual(['quickfix', 'quickfix', 'extract', 'other']);
        expect(entries[3]!.action.command).toEqual({ title: 'Run', command: 'x.run' });
        expect(new Set(entries.map((entry) => entry.id)).size).toBe(4);
    });

    test('lists the rewrites after the fixes and the refactorings after them, and Refactor This puts the structure first', () => {
        const answer = [
            { title: 'Rewrite', kind: 'refactor.rewrite' },
            { title: 'Move', kind: 'refactor.move' },
            { title: 'Fix', kind: 'quickfix' },
            { title: 'Inline', kind: 'refactor.inline' },
            { title: 'Extract', kind: 'refactor.extract' }
        ];
        expect(actionsOf(answer).map((entry) => entry.action.title)).toEqual(['Fix', 'Rewrite', 'Extract', 'Inline', 'Move']);
        expect(actionsOf(answer, REFACTOR_GROUPS).map((entry) => entry.action.title)).toEqual(['Extract', 'Inline', 'Move', 'Rewrite']);
    });

    test('merges lists in the order of one answer, drops an action with the same kind and title, and numbers the rows again', () => {
        const merged = mergeEntries([
            actionsOf([{ title: 'Extract', kind: 'refactor.extract' }]),
            actionsOf([
                { title: 'Fix', kind: 'quickfix' },
                { title: 'Extract', kind: 'refactor.extract' }
            ])
        ]);
        expect(merged.map((entry) => [entry.id, entry.action.title])).toEqual([
            ['0', 'Fix'],
            ['1', 'Extract']
        ]);
    });

    test('picks the errors and warnings that are on a line, errors first', () => {
        const picked = fixableOnLine(
            [
                { range: range(2, 8, 9), message: 'warning', severity: 2 },
                { range: range(2, 14, 15), message: 'error', severity: 1 },
                { range: range(2, 0, 1), message: 'hint', severity: 4 },
                { range: range(3, 0, 1), message: 'elsewhere', severity: 1 },
                { range: { start: { line: 1, character: 0 }, end: { line: 4, character: 1 } }, message: 'spans the line', severity: 1 }
            ],
            2
        );
        expect(picked.map((diagnostic) => diagnostic.message)).toEqual(['spans the line', 'error', 'warning']);
    });

    test('hints at everything but source actions', () => {
        const [fix, source] = actionsOf([
            { title: 'Fix', kind: 'quickfix' },
            { title: 'Organize', kind: 'source.organizeImports' }
        ]);
        expect(isHint(fix!)).toBe(true);
        expect(isHint(source!)).toBe(false);
    });

    test('hands a server the problems that touch the range it was asked about', () => {
        const near = { range: range(2, 4, 8), message: 'near' };
        const far = { range: range(5, 0, 3), message: 'far' };
        expect(diagnosticsAt([near, far], range(2, 8, 8))).toEqual([near]);
        expect(diagnosticsAt([near, far], range(2, 9, 9))).toEqual([]);
    });
});

describe('preview of an edit', () => {
    const text = 'const a = 1;\nconst salary = old(x);\nreturn salary;';

    test('shows the lines an edit replaces and the lines that replace them', () => {
        const edit = { changes: { [uri]: [{ range: range(1, 15, 18), newText: 'fresh' }] } };
        expect(previewOf(text, edit, uri)).toEqual({
            removed: ['const salary = old(x);'],
            added: ['const salary = fresh(x);'],
            hiddenLines: 0,
            otherFiles: 0,
            moves: 0
        });
    });

    test('cuts a long change short and counts the files it reaches besides this one', () => {
        const long = Array.from({ length: 6 }, (_, index) => `line ${index}`).join('\n');
        const edit = {
            changes: {
                [uri]: [{ range: range(0, 0, 0), newText: `${long}\n` }],
                'file:///work/b.ts': [{ range: range(0, 0, 0), newText: 'x' }]
            }
        };
        const preview = previewOf(text, edit, uri)!;
        expect(preview.added).toHaveLength(3);
        expect(preview.hiddenLines).toBe(3);
        expect(preview.otherFiles).toBe(1);
    });

    test('counts the files an edit moves, and shows them even when no line changes', () => {
        const edit = { documentChanges: [{ kind: 'rename' as const, oldUri: uri, newUri: 'file:///work/b.ts' }] };
        expect(previewOf(text, edit, uri)).toEqual({ removed: [], added: [], hiddenLines: 0, otherFiles: 0, moves: 1 });
    });

    test('has none for an edit that changes nothing or one that cannot be shown', () => {
        expect(previewOf(text, { changes: { [uri]: [{ range: range(0, 0, 0), newText: '' }] } }, uri)).toBeNull();
        expect(previewOf(text, { documentChanges: [{ kind: 'delete', uri }] }, uri)).toBeNull();
        expect(previewOf(text, { changes: { [uri]: [{ range: range(9, 0, 0), newText: 'x' }] } }, uri)).toBeNull();
    });
});
