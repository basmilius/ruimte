import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { registerCell } from '@/layout/cell-rects';
import { useDocument } from '@/state/document';
import { languageForCommand, registerFocusedLanguage } from './focused-language';
import type { EditorLanguage } from './ruimte-editor-language';

/* A box that contains what was put in it, and hears focusin the way an element does. */
class FakeBox extends EventTarget {
    readonly children = new Set<unknown>();

    contains(node: unknown): boolean {
        return node === this || this.children.has(node);
    }
}

function fakeLanguage(): { language: EditorLanguage; focused: () => number } {
    let focused = 0;
    const language = { editor: { focus: () => void (focused += 1) } } as unknown as EditorLanguage;
    return { language, focused: () => focused };
}

describe('the editor a menu command means', () => {
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

    function mount(cell: FakeBox, surface: FakeBox, language: EditorLanguage): void {
        cell.children.add(surface);
        registerCell('view', cell as unknown as HTMLElement);
        cleanups.push(() => registerCell('view', null));
        cleanups.push(registerFocusedLanguage(language, surface as unknown as HTMLElement));
    }

    test('is the editor with the keyboard, which is not focused again', () => {
        const { language, focused } = fakeLanguage();
        const surface = new FakeBox();
        const input = {};
        surface.children.add(input);
        mount(new FakeBox(), surface, language);
        active = input;
        expect(languageForCommand()).toBe(language);
        expect(focused()).toBe(0);
    });

    test('is the editor the active view had last once the keyboard left it for something else in the view', () => {
        const { language, focused } = fakeLanguage();
        const cell = new FakeBox();
        const surface = new FakeBox();
        const other = {};
        cell.children.add(other);
        mount(cell, surface, language);
        surface.dispatchEvent(new Event('focusin'));
        active = other;
        expect(languageForCommand()).toBe(language);
        expect(focused()).toBe(1);
    });

    test('is nothing when the active view has no editor that ever had the keyboard', () => {
        const { language, focused } = fakeLanguage();
        mount(new FakeBox(), new FakeBox(), language);
        active = {};
        expect(languageForCommand()).toBeNull();
        expect(focused()).toBe(0);
    });

    test('is nothing for an editor that sits in another view', () => {
        const { language, focused } = fakeLanguage();
        const surface = new FakeBox();
        mount(new FakeBox(), surface, language);
        surface.dispatchEvent(new Event('focusin'));
        useDocument.setState({ activeViewId: 'elsewhere' });
        active = {};
        expect(languageForCommand()).toBeNull();
        expect(focused()).toBe(0);
    });
});
