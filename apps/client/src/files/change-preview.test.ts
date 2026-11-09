import { describe, expect, spyOn, test } from 'bun:test';
import { ManualTimers } from '@adecore/editor-react/testing';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { boundedLines, createChangePreview } from './change-preview';

function setup(base: string, text: string) {
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text, theme: 'light' });
    const timers = new ManualTimers();
    const preview = createChangePreview(editor, base, timers);
    const hover = (line: number, kind: 'modified' | 'added' | 'deleted' = 'modified', layer = 'git') =>
        editor.hoverChangeMark({
            layer,
            line,
            mark: { kind, startLine: line, endLine: line },
            rect: { left: 60, right: 64, top: 20, bottom: 40 }
        });
    return { editor, preview, timers, hover };
}

describe('a change preview against the commit', () => {
    for (const [name, base, text, line, kind, expected] of [
        ['replacement', 'a\nb\nc\n', 'a\nB\nc\n', 2, 'modified', 'a\nb\nc\n'],
        ['growing replacement from its added part', 'a\nb\nc\n', 'a\nX\nY\nZ\nc\n', 4, 'added', 'a\nb\nc\n'],
        ['shrinking replacement', 'a\nb\nc\nd\ne\n', 'a\nX\ne\n', 2, 'modified', 'a\nb\nc\nd\ne\n'],
        ['second row of a multi-line replacement', 'a\nb\nc\nd\n', 'a\nX\nY\nd\n', 3, 'modified', 'a\nb\nc\nd\n'],
        ['insertion at start', 'a\n', 'new\na\n', 1, 'added', 'a\n'],
        ['removal at start', 'old\na\n', 'a\n', 1, 'deleted', 'old\na\n'],
        ['removal at end without final newline', 'a\nb', 'a', 1, 'deleted', 'a\nb'],
        ['removal at end with final newline', 'a\nb\n', 'a\n', 2, 'deleted', 'a\nb\n'],
        ['empty editor', 'a\nb\n', '', 1, 'deleted', 'a\nb\n'],
        ['new file', '', 'a\nb', 1, 'added', ''],
        ['CRLF', 'a\r\nb\r\n', 'a\r\nB\r\n', 2, 'modified', 'a\r\nb\r\n'],
        ['current final newline', 'a\nb', 'a\nB\n', 2, 'modified', 'a\nb\n'],
        ['current line ending', 'a\r\nb\r\n', 'a\nB\n', 2, 'modified', 'a\nb\n'],
        ['another hunk stays', 'a\nb\nc\nd\ne\n', 'A\nb\nc\nd\nE\n', 5, 'modified', 'A\nb\nc\nd\ne\n']
    ] as const) {
        test(`${name} reverts only its hunk as one undoable edit`, () => {
            const run = setup(base, text);
            run.hover(line, kind);
            expect(run.preview.getState().preview).not.toBeNull();
            expect(run.preview.revert()).toBe(true);
            expect(run.editor.getText()).toBe(expected);
            expect(run.preview.getState().preview).toBeNull();
            expect(run.editor.runCommand('undo')).toBe(true);
            expect(run.editor.getText()).toBe(text);
            run.preview.dispose();
        });
    }

    test('deletions sharing a clamped EOF anchor are restored in order', () => {
        const run = setup('a\nX\nb\nc', 'a\nb');
        run.hover(2, 'deleted');
        expect(run.preview.getState().preview?.before).toEqual(['X']);
        expect(run.preview.revert()).toBe(true);
        expect(run.editor.getText()).toBe('a\nX\nb');
        run.hover(3, 'deleted');
        expect(run.preview.getState().preview?.before).toEqual(['c']);
        expect(run.preview.revert()).toBe(true);
        expect(run.editor.getText()).toBe('a\nX\nb\nc');
        run.preview.dispose();
    });

    test('geometry-only hovers reuse the document read until a text change invalidates it', () => {
        const run = setup('old\n', 'new\n');
        const read = spyOn(run.editor, 'getText');
        try {
            run.hover(1);
            run.editor.hoverChangeMark({
                layer: 'git',
                line: 1,
                mark: { kind: 'modified', startLine: 1, endLine: 1 },
                rect: { left: 60, right: 64, top: 40, bottom: 60 }
            });
            expect(read).toHaveBeenCalledTimes(1);
            expect(run.preview.getState().preview?.rect.top).toBe(40);
            run.editor.setText('newer\n');
            run.hover(1);
            expect(read).toHaveBeenCalledTimes(2);
            expect(run.preview.getState().preview?.after).toEqual(['newer']);
        } finally {
            read.mockRestore();
            run.preview.dispose();
        }
    });

    test('a held card survives leaving the gutter, but edits, another layer and disposal invalidate it', () => {
        const run = setup('old\n', 'new\n');
        run.hover(1);
        run.editor.hoverChangeMark(null);
        run.timers.advance(199);
        expect(run.preview.getState().preview).not.toBeNull();
        run.preview.hold(true);
        run.timers.advance(1000);
        expect(run.preview.getState().preview).not.toBeNull();
        run.preview.hold(false);
        run.timers.advance(200);
        expect(run.preview.getState().preview).toBeNull();
        run.hover(1);
        run.editor.setText('newer\n');
        expect(run.preview.revert()).toBe(false);
        expect(run.editor.getText()).toBe('newer\n');
        run.hover(1, 'modified', 'review');
        expect(run.preview.getState().preview).toBeNull();
        run.hover(1);
        run.preview.dispose();
        run.hover(1);
        expect(run.preview.revert()).toBe(false);
        expect(run.timers.size).toBe(0);
    });

    test('the fresh hunk wins over a delayed margin and read-only refusal is respected', () => {
        const run = setup('a\nb\n', 'a\nB\n');
        run.editor.setText('A\nb\n');
        run.hover(2);
        expect(run.preview.getState().preview).toBeNull();
        run.hover(1);
        expect(run.preview.getState().preview?.before).toEqual(['a']);
        run.editor.setReadOnly(true);
        expect(run.preview.revert()).toBe(false);
        expect(run.editor.getText()).toBe('A\nb\n');
        run.preview.dispose();
    });
});

describe('the lines a card draws', () => {
    test('whole lines pass through untouched', () => {
        expect(boundedLines(['a', 'b'])).toEqual({ text: 'a\nb', truncated: false });
    });

    test('a long line is cut and flagged', () => {
        const shown = boundedLines(['x'.repeat(2500)]);

        expect(shown.text).toHaveLength(2000);
        expect(shown.truncated).toBe(true);
    });

    test('more than 100 lines are cut and flagged', () => {
        const shown = boundedLines(Array.from({ length: 150 }, () => 'x'));

        expect(shown.text.split('\n')).toHaveLength(100);
        expect(shown.truncated).toBe(true);
    });

    test('the total length is capped across lines', () => {
        const shown = boundedLines(Array.from({ length: 10 }, () => 'x'.repeat(1500)));

        expect(shown.text.length).toBeLessThanOrEqual(12_000 + 10);
        expect(shown.truncated).toBe(true);
    });
});
