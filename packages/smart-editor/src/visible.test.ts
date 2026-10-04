import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from './fake.ts';
import { mountEditor } from './testing.ts';

describe('getVisibleRange', () => {
    test('runs from the start of the first line in view to the end of the last', () => {
        const { editor } = mountEditor({ text: 'one\ntwo\nthree' });
        const range = editor.getVisibleRange();
        expect(range.start).toEqual({ line: 0, character: 0 });
        expect(range.end.line).toBeLessThanOrEqual(2);
        expect(range.end.character).toBe(
            editor.textInRange({ start: { line: range.end.line, character: 0 }, end: { line: range.end.line, character: 99 } }).length
        );
        editor.dispose();
    });

    test('is the whole text in the fake until a test scrolls', () => {
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'one\ntwo', theme: 'dark' });
        expect(editor.getVisibleRange()).toEqual({ start: { line: 0, character: 0 }, end: { line: 1, character: 3 } });
        let heard = 0;
        editor.onViewChange(() => heard++);
        editor.scroll({ start: { line: 1, character: 0 }, end: { line: 1, character: 3 } });
        expect(heard).toBe(1);
        expect(editor.getVisibleRange().start.line).toBe(1);
    });
});
