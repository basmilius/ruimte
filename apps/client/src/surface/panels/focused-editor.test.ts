import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Editor } from '@adecore/editor';
import { registerCell } from '@/layout/cell-rects';
import { useDocument } from '@/state/document';
import { activeViewEditorFor, editorForCommand, registerFocusedEditor } from './focused-editor';

/* A box that contains what was put in it, and hears focusin the way an element does. */
class FakeBox extends EventTarget {
    readonly children = new Set<unknown>();

    contains(node: unknown): boolean {
        return node === this || this.children.has(node);
    }
}

function fakeEditor(): { editor: Editor; focused: () => number } {
    let focused = 0;
    const editor = { focus: () => void (focused += 1) } as unknown as Editor;
    return { editor, focused: () => focused };
}

describe('the editor an editing command means', () => {
    const globals = globalThis as { document?: unknown };
    const previous = globals.document;
    const cleanups: (() => void)[] = [];
    let active: unknown = null;

    beforeEach(() => {
        active = null;
        globals.document = {
            get activeElement() {
                return active;
            }
        };
        useDocument.setState({ activeViewId: 'view' });
    });

    afterEach(() => {
        cleanups.splice(0).forEach((cleanup) => cleanup());
        globals.document = previous;
        useDocument.setState({ activeViewId: null });
    });

    function mount(cell: FakeBox, surface: FakeBox, editor: Editor): void {
        cell.children.add(surface);
        registerCell('view', cell as unknown as HTMLElement);
        cleanups.push(() => registerCell('view', null));
        cleanups.push(registerFocusedEditor(editor, surface as unknown as HTMLElement));
    }

    test('is the editor with the keyboard, which is not focused again', () => {
        const { editor, focused } = fakeEditor();
        const surface = new FakeBox();
        const input = {};
        surface.children.add(input);
        mount(new FakeBox(), surface, editor);
        active = input;
        expect(editorForCommand()).toBe(editor);
        expect(focused()).toBe(0);
    });

    test('is the editor the active view had last once the keyboard left it, and gets the keyboard back', () => {
        const { editor, focused } = fakeEditor();
        const cell = new FakeBox();
        const surface = new FakeBox();
        const other = {};
        cell.children.add(other);
        mount(cell, surface, editor);
        surface.dispatchEvent(new Event('focusin'));
        active = other;
        expect(editorForCommand()).toBe(editor);
        expect(focused()).toBe(1);
    });

    test('is nothing for an editor that never had the keyboard or sits in another view', () => {
        const { editor, focused } = fakeEditor();
        const surface = new FakeBox();
        mount(new FakeBox(), surface, editor);
        active = {};
        expect(editorForCommand()).toBeNull();
        surface.dispatchEvent(new Event('focusin'));
        useDocument.setState({ activeViewId: 'elsewhere' });
        expect(editorForCommand()).toBeNull();
        expect(focused()).toBe(0);
    });

    test('is the active view editor for a surface inside that view only', () => {
        const { editor } = fakeEditor();
        const cell = new FakeBox();
        const surface = new FakeBox();
        const inside = {};
        cell.children.add(inside);
        mount(cell, surface, editor);
        surface.dispatchEvent(new Event('focusin'));
        expect(activeViewEditorFor(inside as unknown as Element)).toBe(editor);
        expect(activeViewEditorFor({} as unknown as Element)).toBeNull();
    });
});
