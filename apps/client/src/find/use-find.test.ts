import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Editor } from '@adecore/editor';
import { registerCell } from '@/layout/cell-rects';
import { useDocument } from '@/state/document';
import { registerFocusedEditor } from '@/surface/panels/focused-editor';
import { findReturnTarget } from './use-find';

class FakeBox extends EventTarget {
    readonly children = new Set<unknown>();

    contains(node: unknown): boolean {
        return node === this || this.children.has(node);
    }
}

describe('where the keyboard goes when the find bar closes', () => {
    const globals = globalThis as { document?: unknown };
    const previous = globals.document;
    const body = { isConnected: true };
    const cleanups: (() => void)[] = [];
    const editor = { focus: () => undefined } as unknown as Editor;
    const cell = new FakeBox();
    const surface = new FakeBox();

    beforeEach(() => {
        globals.document = { body, activeElement: body };
        cell.children.add(surface);
        registerCell('view', cell as unknown as HTMLElement);
        cleanups.push(() => registerCell('view', null));
        cleanups.push(registerFocusedEditor(editor, surface as unknown as HTMLElement));
        surface.dispatchEvent(new Event('focusin'));
        useDocument.setState({ activeViewId: 'view' });
    });

    afterEach(() => {
        cleanups.splice(0).forEach((cleanup) => cleanup());
        globals.document = previous;
        useDocument.setState({ activeViewId: null });
    });

    test('is where it was when that is still on the page', () => {
        const remembered = { isConnected: true } as unknown as HTMLElement;
        expect(findReturnTarget(remembered, surface as unknown as HTMLElement)).toBe(remembered);
    });

    test('is the last editor of the view when the bar was opened from the body', () => {
        expect(findReturnTarget(body as unknown as HTMLElement, surface as unknown as HTMLElement)).toBe(editor);
        expect(findReturnTarget(null, surface as unknown as HTMLElement)).toBe(editor);
    });

    test('is the last editor of the view when where it was has left the page', () => {
        const gone = { isConnected: false } as unknown as HTMLElement;
        expect(findReturnTarget(gone, surface as unknown as HTMLElement)).toBe(editor);
    });

    test('is nothing for a bar that belongs to another view', () => {
        useDocument.setState({ activeViewId: 'elsewhere' });
        expect(findReturnTarget(null, surface as unknown as HTMLElement)).toBeNull();
    });
});
