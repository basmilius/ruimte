import { parseHTML } from 'linkedom';
import { createSmartEditorEngine } from './engine.ts';
import type { Editor, EditorOptions, SmartEditorEngineOptions } from './types.ts';

/*
 * A page for tests: linkedom has no layout, so every box is the editor's fallback size, and its
 * textarea has no selection of its own, which the editor's input sink reads and writes.
 */
export function createPage(): { document: Document; window: Window & typeof globalThis; host: HTMLElement } {
    const { document, window } = parseHTML('<html><body><div id="host"></div></body></html>');
    const prototype = (window as unknown as { HTMLTextAreaElement: { prototype: Record<string, unknown> } }).HTMLTextAreaElement.prototype;
    const selections = new WeakMap<object, { start: number; end: number; direction: string }>();
    const read = (element: object): { start: number; end: number; direction: string } => selections.get(element) ?? { start: 0, end: 0, direction: 'none' };
    Object.defineProperty(prototype, 'selectionStart', {
        get: function (this: object) {
            return read(this).start;
        },
        configurable: true
    });
    Object.defineProperty(prototype, 'selectionEnd', {
        get: function (this: object) {
            return read(this).end;
        },
        configurable: true
    });
    Object.defineProperty(prototype, 'selectionDirection', {
        get: function (this: object) {
            return read(this).direction;
        },
        configurable: true
    });
    prototype.setSelectionRange = function (this: object, start: number, end: number, direction = 'none'): void {
        selections.set(this, { start, end, direction });
    };
    const element = (window as unknown as { HTMLElement: { prototype: object } }).HTMLElement.prototype;
    for (const name of ['scrollTop', 'scrollLeft']) {
        Object.defineProperty(element, name, { value: 0, writable: true, configurable: true });
    }
    return {
        document: document as unknown as Document,
        window: window as unknown as Window & typeof globalThis,
        host: document.getElementById('host') as unknown as HTMLElement
    };
}

export interface KeyOptions {
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
}

/* Fires a keydown at the element and says whether the editor took the key. */
export function press(window: Window, target: Element, key: string, options: KeyOptions = {}): boolean {
    const event = new (window as unknown as { Event: typeof Event }).Event('keydown', { bubbles: true, cancelable: true });
    Object.assign(event, { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, ...options });
    target.dispatchEvent(event);
    return event.defaultPrevented;
}

/* Fires a keyup at the element, the other half of `press`. */
export function release(window: Window, target: Element, key: string, options: KeyOptions = {}): void {
    const event = new (window as unknown as { Event: typeof Event }).Event('keyup', { bubbles: true, cancelable: true });
    Object.assign(event, { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, ...options });
    target.dispatchEvent(event);
}

/* What a browser sends before it puts text in a textarea. */
export function typeInto(window: Window, target: Element, text: string): void {
    const event = new (window as unknown as { Event: typeof Event }).Event('beforeinput', { bubbles: true, cancelable: true });
    Object.assign(event, { inputType: 'insertText', data: text, isComposing: false });
    target.dispatchEvent(event);
}

/* A clipboard event with the data it carries; what a copy or cut sets is read back through `data`. */
export function clipboard(
    window: Window,
    target: Element,
    type: 'copy' | 'cut' | 'paste',
    data: { text: string } = { text: '' }
): { prevented: boolean; text: string } {
    const event = new (window as unknown as { Event: typeof Event }).Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
        clipboardData: {
            getData: () => data.text,
            setData: (_format: string, value: string) => {
                data.text = value;
            }
        }
    });
    target.dispatchEvent(event);
    return { prevented: event.defaultPrevented, text: data.text };
}

/* A pointer event at a point of the screen; the page has no scroll or scale, so it is also the point of the content. */
export function pointer(
    window: Window,
    target: Element,
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
    x: number,
    y: number,
    options: KeyOptions = {}
): void {
    const event = new (window as unknown as { Event: typeof Event }).Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
        clientX: x,
        clientY: y,
        button: 0,
        pointerId: 1,
        detail: 0,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        ...options
    });
    target.dispatchEvent(event);
}

export interface MountedEditor {
    editor: Editor;
    page: ReturnType<typeof createPage>;
    input: HTMLTextAreaElement;
    viewport: HTMLElement;
    press(key: string, modifiers?: KeyOptions): boolean;
    release(key: string, modifiers?: KeyOptions): void;
    type(text: string): void;
    /* Copies, cuts or pastes through the clipboard; the text a copy or cut left comes back. */
    clip(type: 'copy' | 'cut' | 'paste', text?: string): string;
    click(x: number, y: number, options?: KeyOptions): void;
}

/* An editor on a page of its own, with the helpers that drive it the way a person would. */
export function mountEditor(options: Partial<EditorOptions> = {}, engineOptions: Partial<SmartEditorEngineOptions> = {}): MountedEditor {
    const page = createPage();
    const editor = createSmartEditorEngine({ tokenizer: async () => null, ...engineOptions }).mount(page.host, {
        text: 'one\ntwo\nthree',
        theme: 'dark',
        ...options
    });
    const input = page.host.querySelector('textarea')!;
    const viewport = page.host.querySelector('.se-viewport') as HTMLElement;
    return {
        editor,
        page,
        input,
        viewport,
        press: (key, modifiers = {}) => press(page.window, input, key, modifiers),
        release: (key, modifiers = {}) => release(page.window, input, key, modifiers),
        type: (text) => typeInto(page.window, input, text),
        clip: (type, text = '') => clipboard(page.window, input, type, { text }).text,
        click: (x, y, modifiers = {}) => {
            pointer(page.window, viewport, 'pointerdown', x, y, modifiers);
            pointer(page.window, viewport, 'pointerup', x, y);
        }
    };
}
