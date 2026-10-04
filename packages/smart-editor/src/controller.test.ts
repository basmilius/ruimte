import { describe, expect, jest, test } from 'bun:test';
import { mountEditor, pointer } from './testing.ts';

/* With the fallback face a character is 7.8px wide and a line 20px tall, and the gutter is as wide as it is at the least. */
const GUTTER = 64;
const column = (n: number): number => GUTTER + Math.round(n * 7.8);
const row = (n: number): number => n * 20 + 5;

describe('the mouse', () => {
    test('puts the caret where it was clicked', () => {
        const { editor, click, type } = mountEditor();
        click(column(2) + 1, row(1));
        type('X');
        expect(editor.getText()).toBe('one\ntwXo\nthree');
    });

    test('puts the caret at the end of a line when the click is past it', () => {
        const { editor, click, type } = mountEditor();
        click(400, row(0));
        type('!');
        expect(editor.getText()).toBe('one!\ntwo\nthree');
    });

    test('selects a word on a double click and a line on a triple click', () => {
        const { editor, click, type } = mountEditor({ text: 'alpha beta_gamma\nnext' });
        click(column(8), row(0));
        click(column(8), row(0));
        type('X');
        expect(editor.getText()).toBe('alpha X\nnext');
        const second = mountEditor({ text: 'alpha beta\nnext' });
        for (let i = 0; i < 3; i++) {
            second.click(column(2), row(0));
        }
        second.type('X');
        expect(second.editor.getText()).toBe('Xnext');
    });

    describe('selecting by words and lines', () => {
        const press = (mounted: ReturnType<typeof mountEditor>, x: number, y: number, options = {}): void =>
            pointer(mounted.page.window, mounted.viewport, 'pointerdown', x, y, options);
        const move = (mounted: ReturnType<typeof mountEditor>, x: number, y: number): void =>
            pointer(mounted.page.window, mounted.page.document.documentElement, 'pointermove', x, y);
        const release = (mounted: ReturnType<typeof mountEditor>, x: number, y: number): void =>
            pointer(mounted.page.window, mounted.page.document.documentElement, 'pointerup', x, y);
        const gutterPress = (mounted: ReturnType<typeof mountEditor>, y: number, options = {}): void =>
            pointer(mounted.page.window, mounted.page.host.querySelector('.se-gutter')!, 'pointerdown', 4, y, options);

        test('a double click selects an identifier, not what a word break says', () => {
            const dotted = mountEditor({ text: 'config.value = 1' });
            dotted.click(column(2) + 1, row(0));
            dotted.click(column(2) + 1, row(0));
            dotted.type('X');
            expect(dotted.editor.getText()).toBe('X.value = 1');
            const php = mountEditor({ text: 'echo $name;', language: 'php' });
            php.click(column(7) + 1, row(0));
            php.click(column(7) + 1, row(0));
            php.type('X');
            expect(php.editor.getText()).toBe('echo X;');
            const vue = mountEditor({ text: '<a @click.prevent="go">' });
            vue.click(column(12) + 1, row(0));
            vue.click(column(12) + 1, row(0));
            vue.type('X');
            expect(vue.editor.getText()).toBe('<a @click.X="go">');
        });

        test('a drag after a double click grows the selection by words, forward and back', () => {
            const forward = mountEditor({ text: 'one two three four' });
            forward.click(column(5) + 1, row(0));
            press(forward, column(5) + 1, row(0));
            move(forward, column(10) + 1, row(0));
            release(forward, column(10) + 1, row(0));
            forward.type('X');
            expect(forward.editor.getText()).toBe('one X four');
            const back = mountEditor({ text: 'one two three four' });
            back.click(column(10) + 1, row(0));
            press(back, column(10) + 1, row(0));
            move(back, column(2) + 1, row(0));
            release(back, column(2) + 1, row(0));
            back.type('X');
            expect(back.editor.getText()).toBe('X four');
        });

        test('a drag after a triple click grows the selection by lines', () => {
            const down = mountEditor({ text: 'one\ntwo\nthree\nfour' });
            for (let i = 0; i < 3; i++) {
                if (i < 2) {
                    down.click(column(1), row(1));
                } else {
                    press(down, column(1), row(1));
                }
            }
            move(down, column(1), row(2));
            release(down, column(1), row(2));
            down.type('X');
            expect(down.editor.getText()).toBe('one\nXfour');
            const up = mountEditor({ text: 'one\ntwo\nthree\nfour' });
            for (let i = 0; i < 3; i++) {
                if (i < 2) {
                    up.click(column(1), row(2));
                } else {
                    press(up, column(1), row(2));
                }
            }
            move(up, column(1), row(0));
            release(up, column(1), row(0));
            up.type('X');
            expect(up.editor.getText()).toBe('Xfour');
        });

        test('a press on a line number selects the line, and a drag from it goes by lines', () => {
            const mounted = mountEditor({ text: 'one\ntwo\nthree\nfour' });
            gutterPress(mounted, row(1));
            move(mounted, column(1), row(2));
            release(mounted, column(1), row(2));
            mounted.type('X');
            expect(mounted.editor.getText()).toBe('one\nXfour');
            const up = mountEditor({ text: 'one\ntwo\nthree\nfour' });
            gutterPress(up, row(2));
            move(up, column(1), row(0));
            release(up, column(1), row(0));
            up.type('X');
            expect(up.editor.getText()).toBe('Xfour');
        });

        test('shift on a line number grows the selected lines, and takes the clicked one out when it is inside', () => {
            const grow = mountEditor({ text: 'one\ntwo\nthree\nfour\nfive' });
            gutterPress(grow, row(1));
            release(grow, 4, row(1));
            gutterPress(grow, row(3), { shiftKey: true });
            expect(grow.editor.getSelection()).toEqual({ start: { line: 1, character: 0 }, end: { line: 3, character: 4 } });
            gutterPress(grow, row(2), { shiftKey: true });
            expect(grow.editor.getSelection()).toEqual({ start: { line: 1, character: 0 }, end: { line: 2, character: 5 } });
            const before = mountEditor({ text: 'one\ntwo\nthree\nfour\nfive' });
            gutterPress(before, row(3));
            release(before, 4, row(3));
            gutterPress(before, row(1), { shiftKey: true });
            expect(before.editor.getSelection()).toEqual({ start: { line: 1, character: 0 }, end: { line: 4, character: 0 } });
        });
    });

    describe('carrying selected text', () => {
        const select = (mounted: ReturnType<typeof mountEditor>): void => {
            mounted.click(column(7) + 1, row(0));
            mounted.click(column(7) + 1, row(0));
            expect(mounted.editor.getSelection()).toEqual({ start: { line: 0, character: 6 }, end: { line: 0, character: 11 } });
        };
        const carry = (mounted: ReturnType<typeof mountEditor>, to: [number, number], release: Record<string, boolean> = {}): void => {
            const target = mounted.page.document.documentElement;
            pointer(mounted.page.window, mounted.viewport, 'pointerdown', column(8) + 1, row(0));
            pointer(mounted.page.window, target, 'pointermove', column(to[0]) + 1, row(to[1]));
            pointer(mounted.page.window, target, 'pointerup', column(to[0]) + 1, row(to[1]), release);
        };

        test('moves the text where the pointer lets go, selects it there and undoes in one step', () => {
            const mounted = mountEditor({ text: 'hello world foo\nsecond' });
            select(mounted);
            carry(mounted, [15, 0]);
            expect(mounted.editor.getText()).toBe('hello  fooworld\nsecond');
            expect(mounted.editor.getSelection()).toEqual({ start: { line: 0, character: 10 }, end: { line: 0, character: 15 } });
            mounted.press('z', { ctrlKey: true });
            expect(mounted.editor.getText()).toBe('hello world foo\nsecond');
        });

        test('moves it back up the document as well', () => {
            const mounted = mountEditor({ text: 'foo\nhello world' });
            mounted.click(column(7) + 1, row(1));
            mounted.click(column(7) + 1, row(1));
            const target = mounted.page.document.documentElement;
            pointer(mounted.page.window, mounted.viewport, 'pointerdown', column(8) + 1, row(1));
            pointer(mounted.page.window, target, 'pointermove', column(0) + 1, row(0));
            pointer(mounted.page.window, target, 'pointerup', column(0) + 1, row(0));
            expect(mounted.editor.getText()).toBe('worldfoo\nhello ');
        });

        test('copies it with the key that says so held at the drop', () => {
            const mounted = mountEditor({ text: 'hello world foo' });
            select(mounted);
            carry(mounted, [15, 0], { ctrlKey: true });
            expect(mounted.editor.getText()).toBe('hello world fooworld');
        });

        test('takes a press on the selection without a drag as a click that puts the caret there', () => {
            const mounted = mountEditor({ text: 'hello world foo' });
            select(mounted);
            mounted.click(column(8) + 1, row(0));
            expect(mounted.editor.getSelection().start).toEqual({ line: 0, character: 8 });
            expect(mounted.editor.getSelection().end).toEqual({ line: 0, character: 8 });
        });

        test('does nothing when it lets go on the text it carries, or when the editor is read only', () => {
            const mounted = mountEditor({ text: 'hello world foo' });
            select(mounted);
            carry(mounted, [9, 0]);
            expect(mounted.editor.getText()).toBe('hello world foo');
            const readOnly = mountEditor({ text: 'hello world foo', readOnly: true });
            select(readOnly);
            carry(readOnly, [15, 0]);
            expect(readOnly.editor.getText()).toBe('hello world foo');
        });

        test('shows where it would land while it is carried', () => {
            const mounted = mountEditor({ text: 'hello world foo' });
            select(mounted);
            const target = mounted.page.document.documentElement;
            pointer(mounted.page.window, mounted.viewport, 'pointerdown', column(8) + 1, row(0));
            expect(mounted.page.host.querySelector('.se-drop-caret')).toBeNull();
            pointer(mounted.page.window, target, 'pointermove', column(14) + 1, row(0));
            expect(mounted.page.host.querySelector('.se-drop-caret')).not.toBeNull();
            pointer(mounted.page.window, target, 'pointercancel', column(14) + 1, row(0));
            expect(mounted.page.host.querySelector('.se-drop-caret')).toBeNull();
            expect(mounted.editor.getText()).toBe('hello world foo');
        });
    });

    test('extends the selection with shift', () => {
        const { editor, click, type } = mountEditor({ text: 'abcdef' });
        click(column(1), row(0));
        click(column(4), row(0), { shiftKey: true });
        type('-');
        expect(editor.getText()).toBe('a-ef');
    });

    test('adds a caret with alt and types at both', () => {
        const { editor, click, type } = mountEditor({ text: 'ab\ncd' });
        click(column(1), row(0));
        click(column(1), row(1), { altKey: true });
        type('-');
        expect(editor.getText()).toBe('a-b\nc-d');
    });

    test('drags out a selection', () => {
        const { editor, page, viewport, type } = mountEditor({ text: 'abcdef' });
        pointer(page.window, viewport, 'pointerdown', column(1), row(0));
        pointer(page.window, page.document.documentElement, 'pointermove', column(4), row(0));
        pointer(page.window, page.document.documentElement, 'pointerup', column(4), row(0));
        type('-');
        expect(editor.getText()).toBe('a-ef');
    });

    describe('with alt held while dragging', () => {
        const drag = (mounted: ReturnType<typeof mountEditor>, from: [number, number], to: [number, number]): void => {
            const target = mounted.page.document.documentElement;
            pointer(mounted.page.window, mounted.viewport, 'pointerdown', column(from[0]), row(from[1]), { altKey: true });
            pointer(mounted.page.window, target, 'pointermove', column(to[0]), row(to[1]), { altKey: true });
            pointer(mounted.page.window, target, 'pointerup', column(to[0]), row(to[1]));
        };

        test('selects the same columns on every line of the box', () => {
            const mounted = mountEditor({ text: 'abcdef\nghijkl\nmnopqr' });
            drag(mounted, [1, 0], [3, 2]);
            mounted.type('-');
            expect(mounted.editor.getText()).toBe('a-def\ng-jkl\nm-pqr');
        });

        test('selects upward as well', () => {
            const mounted = mountEditor({ text: 'abcdef\nghijkl\nmnopqr' });
            drag(mounted, [4, 2], [2, 0]);
            mounted.type('-');
            expect(mounted.editor.getText()).toBe('ab-ef\ngh-kl\nmn-qr');
        });

        test('clamps a short line to its end and skips a line that ends before the box', () => {
            const mounted = mountEditor({ text: 'abcdef\nab\nabcdef' });
            drag(mounted, [3, 0], [5, 2]);
            mounted.type('-');
            expect(mounted.editor.getText()).toBe('abc-f\nab\nabc-f');
            const clamped = mountEditor({ text: 'abcdef\nabcd\nabcdef' });
            drag(clamped, [3, 0], [5, 2]);
            clamped.type('-');
            expect(clamped.editor.getText()).toBe('abc-f\nabc-\nabc-f');
        });

        test('puts a caret at the end of a short line when the box is a column of carets', () => {
            const mounted = mountEditor({ text: 'abcdef\nab\nabcdef' });
            drag(mounted, [4, 0], [4, 2]);
            mounted.type('-');
            expect(mounted.editor.getText()).toBe('abcd-ef\nab-\nabcd-ef');
        });

        test('measures a tab as the columns it expands to', () => {
            const mounted = mountEditor({ text: '\tabcd\n    abcd' });
            drag(mounted, [5, 0], [7, 1]);
            mounted.type('-');
            expect(mounted.editor.getText()).toBe('\ta-d\n    a-d');
        });

        test('a press without a drag still adds a caret', () => {
            const mounted = mountEditor({ text: 'ab\ncd' });
            mounted.click(column(1), row(0));
            mounted.click(column(1), row(1), { altKey: true });
            mounted.type('-');
            expect(mounted.editor.getText()).toBe('a-b\nc-d');
        });
    });

    test('selects a line from its number', () => {
        const { editor, page, type } = mountEditor({ text: 'one\ntwo\nthree' });
        pointer(page.window, page.host.querySelector('.se-gutter')!, 'pointerdown', 4, row(1));
        type('X');
        expect(editor.getText()).toBe('one\nXthree');
    });
});

describe('the keyboard', () => {
    test('moves the caret with the arrow keys, over line ends and at a remembered column', () => {
        const { editor, press, type } = mountEditor({ text: 'abcd\nx\nabcd', line: 1, column: 4 });
        press('ArrowDown');
        press('ArrowDown');
        type('!');
        expect(editor.getText()).toBe('abcd\nx\nabc!d');
        press('ArrowUp');
        press('ArrowLeft');
        type('?');
        expect(editor.getText()).toBe('abcd\n?x\nabc!d');
    });

    test('pages by whole lines, with the caret on the same row of the screen', () => {
        const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
        const { editor, press, viewport } = mountEditor({ text, line: 3, column: 3 });
        press('PageDown');
        expect(viewport.scrollTop).toBe(400);
        expect(editor.getCaret()).toEqual({ line: 22, character: 2 });
        press('PageDown');
        expect(viewport.scrollTop).toBe(800);
        expect(editor.getCaret()).toEqual({ line: 42, character: 2 });
        press('PageUp');
        expect(viewport.scrollTop).toBe(400);
        expect(editor.getCaret()).toEqual({ line: 22, character: 2 });
    });

    test('keeps a line of margin below the caret while it moves down and above it while it moves up', () => {
        const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
        const { press, viewport } = mountEditor({ text, line: 19 });
        expect(viewport.scrollTop).toBe(0);
        press('ArrowDown');
        expect(viewport.scrollTop).toBe(20);
        press('ArrowDown');
        expect(viewport.scrollTop).toBe(40);
        viewport.scrollTop = 400;
        for (let i = 0; i < 3; i++) {
            press('ArrowUp');
        }
        press('ArrowUp');
        expect(viewport.scrollTop).toBeLessThan(400);
    });

    test('puts a jump to a line out of view a third from the top and leaves one in view alone', () => {
        const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
        const { editor, viewport } = mountEditor({ text });
        editor.revealLine(10);
        expect(viewport.scrollTop).toBe(0);
        editor.revealLine(61);
        expect(viewport.scrollTop).toBe(60 * 20 - 133);
        editor.setCaret({ line: 80, character: 0 }, 'centerDown');
        expect(viewport.scrollTop).toBe(80 * 20 - 133);
        editor.setCaret({ line: 80, character: 1 });
        expect(viewport.scrollTop).toBe(80 * 20 - 133);
    });

    test('goes by the rows of a wrapped line on Home and End', () => {
        const text = 'abcd '.repeat(40).trimEnd();
        const { editor, press, viewport } = mountEditor({ text });
        // linkedom has no layout, so the view is given a width to wrap at: about 40 characters beside the gutter.
        Object.defineProperty(viewport, 'clientWidth', { value: 400 });
        editor.setWrap(true);
        press('End');
        const rowText = editor.getCaret().character;
        expect(rowText).toBeLessThan(text.length);
        expect(text[rowText]).toBe(' ');
        press('End');
        expect(editor.getCaret().character).toBe(rowText + 1);
        press('End');
        expect(editor.getCaret().character).toBe(text.length);
        press('ArrowLeft');
        press('Home');
        expect(editor.getCaret().character).toBe(160);
        press('Home');
        expect(editor.getCaret().character).toBe(0);
    });

    test('stops paging at the ends of the text and extends the selection with shift', () => {
        const text = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
        const { editor, press, viewport } = mountEditor({ text });
        press('PageDown', { shiftKey: true });
        expect(editor.getSelection().end.line).toBe(20);
        press('PageDown');
        press('PageDown');
        expect(viewport.scrollTop).toBe(30 * 20 + 8 - 400);
        expect(editor.getCaret().line).toBe(29);
        press('PageUp');
        press('PageUp');
        press('PageUp');
        expect(viewport.scrollTop).toBe(0);
        expect(editor.getCaret()).toEqual({ line: 0, character: 0 });
    });

    test('selects with shift and replaces the selection by typing', () => {
        const { editor, press, type } = mountEditor({ text: 'abcdef' });
        press('ArrowRight');
        press('ArrowRight', { shiftKey: true });
        press('ArrowRight', { shiftKey: true });
        type('-');
        expect(editor.getText()).toBe('a-def');
    });

    test('jumps by word and to the ends of a line and of the document', () => {
        const { editor, press, type } = mountEditor({ text: 'one two\nthree' });
        press('ArrowRight', { ctrlKey: true });
        type('|');
        press('End');
        type('$');
        press('End', { ctrlKey: true });
        type('#');
        expect(editor.getText()).toBe('one| two$\nthree#');
    });

    test('moves a line up and down', () => {
        const { editor, press } = mountEditor({ text: 'a\nb\nc' });
        press('ArrowDown', { altKey: true, shiftKey: true });
        expect(editor.getText()).toBe('b\na\nc');
        press('ArrowUp', { altKey: true, shiftKey: true });
        expect(editor.getText()).toBe('a\nb\nc');
    });

    test('adds a caret on the next line with the add caret command', () => {
        const { editor, type } = mountEditor({ text: 'ab\ncd' });
        editor.runCommand('addCaretBelow');
        type('-');
        expect(editor.getText()).toBe('-ab\n-cd');
    });

    test('selects occurrences with the platform keys: next, unselect, all, and a caret on each selected line', () => {
        const { editor, press, type } = mountEditor({ text: 'foo bar foo\nbaz foo' });
        press('j', { altKey: true });
        expect(editor.getSelection()).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 3 } });
        press('j', { altKey: true });
        press('j', { altKey: true });
        type('X');
        expect(editor.getText()).toBe('X bar X\nbaz X');
        press('z', { ctrlKey: true });
        press('j', { altKey: true, shiftKey: true });
        expect(editor.getCaret()).toEqual({ line: 0, character: 11 });
        press('Escape');
        press('j', { ctrlKey: true, altKey: true, shiftKey: true });
        type('Y');
        expect(editor.getText()).toBe('Y bar Y\nbaz Y');
    });

    test('says when select next occurrence has no more', () => {
        const mounted = mountEditor({ text: 'foo bar foo', messages: { noMoreOccurrences: 'No more' } });
        mounted.editor.setSelection({ start: { line: 0, character: 8 }, end: { line: 0, character: 11 } });
        mounted.press('j', { altKey: true });
        expect(mounted.page.host.querySelector('.se-notice')!.textContent).toBe('No more');
    });

    test('puts a caret at the end of each selected line', () => {
        const { editor, press, type } = mountEditor({ text: 'ab\ncd\nef' });
        editor.setSelection({ start: { line: 0, character: 1 }, end: { line: 2, character: 1 } });
        press('g', { altKey: true, shiftKey: true });
        type('!');
        expect(editor.getText()).toBe('ab!\ncd!\nef!');
    });

    test('collapses several carets and a selection on Escape, and leaves a lone caret to the page', () => {
        const { editor, press, type } = mountEditor({ text: 'ab\ncd' });
        editor.runCommand('addCaretBelow');
        expect(press('Escape')).toBe(true);
        type('-');
        expect(editor.getText()).toBe('-ab\ncd');
        expect(press('Escape')).toBe(false);
    });

    test('reads the newest caret for the language features and keeps the oldest on Escape', () => {
        const { editor, press } = mountEditor({ text: 'ab\ncd\nef' });
        editor.runCommand('addCaretBelow');
        editor.runCommand('addCaretBelow');
        expect(editor.getCaret()).toEqual({ line: 2, character: 0 });
        press('Escape');
        expect(editor.getCaret()).toEqual({ line: 0, character: 0 });
    });

    test('jumps to the matching bracket', () => {
        const { editor, press, type } = mountEditor({ text: 'f(a, b)', language: 'typescript' });
        press('ArrowRight');
        press('ArrowRight');
        press('m', { ctrlKey: true });
        type('!');
        expect(editor.getText()).toBe('f(a, b)!');
    });
});

describe('the clipboard', () => {
    function clipboardEvent(window: Window, name: string, data: { text?: string }): { event: Event; written: string[] } {
        const written: string[] = [];
        const event = new (window as unknown as { Event: typeof Event }).Event(name, { bubbles: true, cancelable: true });
        Object.assign(event, { clipboardData: { getData: () => data.text ?? '', setData: (_type: string, text: string) => written.push(text) } });
        return { event, written };
    }

    test('pastes at every caret, with the line breaks of the document', () => {
        const { editor, page, input } = mountEditor({ text: 'a\r\nb' });
        const { event } = clipboardEvent(page.window, 'paste', { text: 'x\ny' });
        input.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(editor.getText()).toBe('x\r\ny' + 'a\r\nb');
    });

    test('copies the selection', () => {
        const { page, input, press } = mountEditor({ text: 'hello world' });
        press('ArrowRight', { shiftKey: true });
        press('ArrowRight', { shiftKey: true });
        const { event, written } = clipboardEvent(page.window, 'copy', {});
        input.dispatchEvent(event);
        expect(written).toEqual(['he']);
    });

    test('copies and cuts the whole line when nothing is selected', () => {
        const { editor, page, input } = mountEditor({ text: 'one\ntwo\nthree', line: 2 });
        const copy = clipboardEvent(page.window, 'copy', {});
        input.dispatchEvent(copy.event);
        expect(copy.written).toEqual(['two\n']);
        const cut = clipboardEvent(page.window, 'cut', {});
        input.dispatchEvent(cut.event);
        expect(editor.getText()).toBe('one\nthree');
    });

    test('refuses a paste and a cut in a read-only editor', () => {
        const { editor, page, input } = mountEditor({ text: 'abc', readOnly: true });
        input.dispatchEvent(clipboardEvent(page.window, 'paste', { text: 'x' }).event);
        input.dispatchEvent(clipboardEvent(page.window, 'cut', {}).event);
        expect(editor.getText()).toBe('abc');
    });
});

describe('an input method', () => {
    function compose(window: Window, input: HTMLTextAreaElement, value: string, caret: number): void {
        input.value = value;
        input.setSelectionRange(caret, caret);
        input.dispatchEvent(new (window as unknown as { Event: typeof Event }).Event('input', { bubbles: true }));
    }

    test('shows what is composed and commits it when the composition ends', () => {
        const { editor, page, input, press } = mountEditor({ text: 'ab' });
        press('ArrowRight');
        input.dispatchEvent(new page.window.Event('compositionstart', { bubbles: true }));
        compose(page.window, input, 'aにb', 2);
        expect(editor.getText()).toBe('ab');
        expect(page.host.querySelector('.se-composition')!.textContent).toBe('に');
        const end = new page.window.Event('compositionend', { bubbles: true });
        Object.assign(end, { data: 'に' });
        input.dispatchEvent(end);
        expect(editor.getText()).toBe('aにb');
        expect(page.host.querySelector('.se-composition')).toBeNull();
    });

    test('types the result of a dead key, so the closer after it is overtyped', () => {
        const text = "console.log('Hallo wereld!)";
        const { editor, page, input, press } = mountEditor({ text, language: 'typescript' });
        press('End');
        press('ArrowLeft');
        input.dispatchEvent(new page.window.Event('compositionstart', { bubbles: true }));
        compose(page.window, input, text.replace(')', "'))"), text.length + 1);
        expect(editor.getText()).toBe(text);
        expect(page.host.querySelector('.se-composition')!.textContent).toBe("')");
        const end = new page.window.Event('compositionend', { bubbles: true });
        Object.assign(end, { data: "')" });
        input.dispatchEvent(end);
        expect(editor.getText()).toBe("console.log('Hallo wereld!')");
    });

    test('keeps the text of a longer composition literal', () => {
        const { editor, page, input, press } = mountEditor({ text: 'a()', language: 'typescript' });
        press('End');
        press('ArrowLeft');
        input.dispatchEvent(new page.window.Event('compositionstart', { bubbles: true }));
        compose(page.window, input, 'a(日本語)', 5);
        const end = new page.window.Event('compositionend', { bubbles: true });
        Object.assign(end, { data: '日本語' });
        input.dispatchEvent(end);
        expect(editor.getText()).toBe('a(日本語)');
    });

    test('commits an edit the platform made to the textarea itself', () => {
        const { editor, page, input } = mountEditor({ text: 'ab' });
        compose(page.window, input, 'aXb', 2);
        expect(editor.getText()).toBe('aXb');
    });
});

describe('the fold control', () => {
    test('folds on the first press, whatever repaints before the button is released', () => {
        jest.useFakeTimers();
        const { page, viewport } = mountEditor({ text: 'function a() {\n    one();\n}\nconst b = 1;\n' });
        jest.runAllTimers();
        jest.useRealTimers();
        const toggle = (): HTMLElement => page.host.querySelector('.se-fold-toggle') as HTMLElement;
        expect(toggle()).not.toBeNull();
        pointer(page.window, toggle(), 'pointerdown', 0, 0);
        pointer(page.window, viewport, 'pointerup', 0, 0);
        expect(toggle().className).toContain('se-folded');
        pointer(page.window, toggle(), 'pointerdown', 0, 0);
        expect(toggle().className).not.toContain('se-folded');
    });
});

describe('the gutter action', () => {
    test('draws one button on its line and reports a press without moving the caret', () => {
        jest.useFakeTimers();
        const { editor, page, viewport } = mountEditor({ text: 'one\ntwo\nthree' });
        jest.runAllTimers();
        jest.useRealTimers();
        const pressed: number[] = [];
        editor.onGutterAction((line) => pressed.push(line));
        editor.setGutterAction({ line: 1, label: 'Show code actions' });
        const button = page.host.querySelector('.se-gutter-action') as HTMLElement;
        expect(button.getAttribute('aria-label')).toBe('Show code actions');
        expect(page.host.querySelectorAll('.se-gutter-action')).toHaveLength(1);
        pointer(page.window, button, 'pointerdown', 0, 0);
        pointer(page.window, viewport, 'pointerup', 0, 0);
        expect(pressed).toEqual([1]);
        editor.setGutterAction(null);
        expect(page.host.querySelectorAll('.se-gutter-action')).toHaveLength(0);
    });
});

describe('clicks the host answers', () => {
    test('offers a press on a character to the host, which can take it and leave the caret alone', () => {
        const { editor, click, type } = mountEditor({ text: 'abcdef' }, { apple: false });
        const seen: unknown[] = [];
        editor.onClick((press) => {
            seen.push(press);
            return press.mod;
        });
        click(column(2) + 1, row(0));
        click(column(4) + 1, row(0), { ctrlKey: true });
        type('-');
        expect(editor.getText()).toBe('ab-cdef');
        expect(seen).toEqual([
            { position: { line: 0, character: 2 }, mod: false, alt: false, shift: false },
            { position: { line: 0, character: 4 }, mod: true, alt: false, shift: false }
        ]);
    });

    test('leaves a press past the end of a line to the editor', () => {
        const { editor, click, type } = mountEditor({ text: 'ab' });
        editor.onClick(() => true);
        click(400, row(0));
        type('!');
        expect(editor.getText()).toBe('ab!');
    });
});

describe('the context menu', () => {
    test('is the host to draw, with the character it was asked on and whether it lies in the selection', () => {
        const { editor, page, viewport } = mountEditor({ text: 'abcdef' });
        const asked: unknown[] = [];
        editor.onContextMenu((menu) => asked.push(menu));
        const event = new (page.window as unknown as { Event: typeof Event }).Event('contextmenu', { bubbles: true, cancelable: true });
        Object.assign(event, { clientX: column(3) + 1, clientY: row(0) });
        viewport.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(asked).toEqual([{ position: { line: 0, character: 3 }, inSelection: false, x: column(3) + 1, y: row(0) }]);
    });
});

describe('widgets', () => {
    test("draws the host's own row under its line and takes it away when the widgets are set again", () => {
        jest.useFakeTimers();
        const { editor, page } = mountEditor({ text: 'one\ntwo\nthree' });
        jest.runAllTimers();
        jest.useRealTimers();
        editor.setWidgets([{ id: 'peek', line: 0, height: 40, render: (container) => (container.textContent = 'references') }]);
        const widget = page.host.querySelector('.se-widget') as HTMLElement;
        expect(widget.textContent).toBe('references');
        editor.setWidgets([]);
        expect(page.host.querySelectorAll('.se-widget')).toHaveLength(0);
    });
});
