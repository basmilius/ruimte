import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { planConflict } from '@adecore/editor-react/models';
import { replaceAllLines, replaceLines } from '@adecore/editor-react/models';

function apply(text: string, from: number, to: number, lines: string[]): string {
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text, theme: 'light' });
    editor.applyEdits([replaceLines(text, { from, to, lines })]);
    return editor.getText();
}

describe('replacing whole lines', () => {
    test('in the middle, at the start and at the end of a file with a final newline', () => {
        expect(apply('a\nb\nc\n', 1, 2, ['x', 'y'])).toBe('a\nx\ny\nc\n');
        expect(apply('a\nb\nc\n', 0, 1, [])).toBe('b\nc\n');
        expect(apply('a\nb\nc\n', 2, 3, ['z'])).toBe('a\nb\nz\n');
        expect(apply('a\nb\nc\n', 3, 3, ['d'])).toBe('a\nb\nc\nd\n');
        expect(apply('a\nb\nc\n', 1, 1, ['ins'])).toBe('a\nins\nb\nc\n');
    });

    test('a file without a final newline keeps having none', () => {
        expect(apply('a\nb\nc', 2, 3, ['z'])).toBe('a\nb\nz');
        expect(apply('a\nb\nc', 1, 3, [])).toBe('a');
        expect(apply('a\nb\nc', 3, 3, ['d'])).toBe('a\nb\nc\nd');
        expect(apply('a\nb\nc', 0, 3, [])).toBe('');
        expect(apply('a\nb\nc', 0, 1, ['x'])).toBe('x\nb\nc');
    });

    test('an empty file takes lines', () => {
        expect(apply('', 0, 0, ['a'])).toBe('a\n');
    });

    test('replacements that touch are one edit', () => {
        const edits = replaceAllLines('a\nb\nc\nd\n', [
            { from: 2, to: 3, lines: ['C'] },
            { from: 1, to: 2, lines: ['B'] }
        ]);
        expect(edits).toHaveLength(1);
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'a\nb\nc\nd\n', theme: 'light' });
        editor.applyEdits(edits);
        expect(editor.getText()).toBe('a\nB\nC\nd\n');
    });
});

describe('the plan of a conflict', () => {
    const base = 'a\nb\nc\nd\ne\nf\ng\n';

    test('what only the other side changed merges, what both changed asks, and what only we changed is ours', () => {
        const plan = planConflict(base, 'A\nb\nc\nD\ne\nf\ng\n', 'a\nb\nc\nD2\ne\nF\ng\nh\n');
        expect(plan.merges).toEqual([
            { from: 5, to: 6, lines: ['F'] },
            { from: 7, to: 7, lines: ['h'] }
        ]);
        expect(plan.conflicts).toEqual([{ base: ['d'], ours: ['D'], theirs: ['D2'], from: 3, to: 4, theirsStart: 4, theirsEnd: 4 }]);
    });

    test('the same change on both sides asks nothing', () => {
        const plan = planConflict(base, 'a\nX\nc\nd\ne\nf\ng\n', 'a\nX\nc\nd\ne\nf\ng\n');
        expect(plan).toEqual({ merges: [], conflicts: [] });
    });

    test('a stretch removed by one side and changed by the other is a conflict with nothing on one side', () => {
        const plan = planConflict(base, 'a\nc\nd\ne\nf\ng\n', 'a\nB\nc\nd\ne\nf\ng\n');
        expect(plan.conflicts).toEqual([{ base: ['b'], ours: [], theirs: ['B'], from: 1, to: 1, theirsStart: 2, theirsEnd: 2 }]);
    });
});
