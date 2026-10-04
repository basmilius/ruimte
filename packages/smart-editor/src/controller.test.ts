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
        press('ArrowDown', { altKey: true });
        expect(editor.getText()).toBe('b\na\nc');
        press('ArrowUp', { altKey: true });
        expect(editor.getText()).toBe('a\nb\nc');
    });

    test('adds a caret on the next line with Alt+Shift+Down', () => {
        const { editor, press, type } = mountEditor({ text: 'ab\ncd' });
        press('ArrowDown', { altKey: true, shiftKey: true });
        type('-');
        expect(editor.getText()).toBe('-ab\n-cd');
    });

    test('collapses several carets and a selection on Escape, and leaves a lone caret to the page', () => {
        const { editor, press, type } = mountEditor({ text: 'ab\ncd' });
        press('ArrowDown', { altKey: true, shiftKey: true });
        expect(press('Escape')).toBe(true);
        type('-');
        expect(editor.getText()).toBe('-ab\ncd');
        expect(press('Escape')).toBe(false);
    });

    test('jumps to the matching bracket', () => {
        const { editor, press, type } = mountEditor({ text: 'f(a, b)', language: 'typescript' });
        press('ArrowRight');
        press('ArrowRight');
        press('m', { ctrlKey: true, shiftKey: true });
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
        expect(page.host.querySelector('.se-inlay')!.textContent).toBe('に');
        const end = new page.window.Event('compositionend', { bubbles: true });
        Object.assign(end, { data: 'に' });
        input.dispatchEvent(end);
        expect(editor.getText()).toBe('aにb');
        expect(page.host.querySelector('.se-inlay')).toBeNull();
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
