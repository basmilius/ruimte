import type { Editor, EditorEngine, EditorOptions, EditorTheme } from './index.ts';
import { emit, type Listener, subscribe } from './listeners.ts';

/* An editor without a DOM, for tests: `type`, `save` and `blur` do what a person would, the rest says what the client asked of it. */
export class FakeEditor implements Editor {
    readonly element: HTMLElement;
    readonly language: string | undefined;
    readonly column: number | null;
    readonly scrollTop: number | null;
    wrap: boolean;
    theme: EditorTheme;
    readOnly: boolean;
    revealedLine: number | null;
    focused = false;
    disposed = false;
    private text: string;
    private readonly changes = new Set<Listener>();
    private readonly saves = new Set<Listener>();
    private readonly blurs = new Set<Listener>();

    constructor(element: HTMLElement, options: EditorOptions) {
        this.element = element;
        this.text = options.text;
        this.language = options.language;
        this.wrap = options.wrap ?? false;
        this.theme = options.theme;
        this.readOnly = options.readOnly ?? false;
        this.revealedLine = options.line ?? null;
        this.column = options.column ?? null;
        this.scrollTop = options.scrollTop ?? null;
    }

    /* A person's edit: the text changes and every change listener hears it. A read-only editor refuses it, as Monaco does. */
    type(text: string): void {
        this.assertLive();
        if (this.readOnly || text === this.text) {
            return;
        }
        this.text = text;
        emit(this.changes);
    }

    /* Mod+S inside the editor. */
    save(): void {
        this.assertLive();
        emit(this.saves);
    }

    /* The focus leaving the editor. */
    blur(): void {
        this.assertLive();
        this.focused = false;
        emit(this.blurs);
    }

    getText(): string {
        return this.text;
    }

    setText(text: string): void {
        this.assertLive();
        this.text = text;
    }

    onChange(listener: Listener): () => void {
        return subscribe(this.changes, listener);
    }

    onSave(listener: Listener): () => void {
        return subscribe(this.saves, listener);
    }

    onBlur(listener: Listener): () => void {
        return subscribe(this.blurs, listener);
    }

    revealLine(line: number): void {
        this.revealedLine = line;
    }

    setWrap(wrap: boolean): void {
        this.wrap = wrap;
    }

    setTheme(theme: EditorTheme): void {
        this.theme = theme;
    }

    setReadOnly(readOnly: boolean): void {
        this.readOnly = readOnly;
    }

    focus(): void {
        this.focused = true;
    }

    dispose(): void {
        this.disposed = true;
        this.changes.clear();
        this.saves.clear();
        this.blurs.clear();
    }

    /* A test that drives an editor its client already disposed has found a leak. */
    private assertLive(): void {
        if (this.disposed) {
            throw new Error('The editor is disposed');
        }
    }
}

export class FakeEditorEngine implements EditorEngine {
    readonly editors: FakeEditor[] = [];

    mount(element: HTMLElement, options: EditorOptions): FakeEditor {
        const editor = new FakeEditor(element, options);
        this.editors.push(editor);
        return editor;
    }

    /* The editor mounted last, which is the one a test of a single surface drives. */
    get last(): FakeEditor {
        const editor = this.editors.at(-1);
        if (!editor) {
            throw new Error('No editor was mounted');
        }
        return editor;
    }
}
