import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { ManualTimers } from '@adecore/editor-react/testing';
import { createChangePreview } from './change-preview';

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
