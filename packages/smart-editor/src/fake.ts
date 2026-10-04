import type {
    Editor,
    EditorBlock,
    EditorChangeMark,
    EditorEngine,
    EditorFindQuery,
    EditorFindState,
    EditorIndentation,
    EditorOptions,
    EditorTheme
} from './types.ts';
import { emit, type Listener, subscribe } from './listeners.ts';

/* An editor without a DOM, for tests: `type`, `save` and `blur` do what a person would, the rest says what the client asked of it. */
export class FakeEditor implements Editor {
    readonly element: HTMLElement;
    readonly language: string | undefined;
    readonly path: string | undefined;
    readonly column: number | null;
    readonly scrollTop: number | null;
    wrap: boolean;
    theme: EditorTheme;
    readOnly: boolean;
    readOnlyReason: string | undefined;
    revealedLine: number | null;
    focused = false;
    indentation: EditorIndentation;
    /* How often the client asked it to read the code face off the page again. */
    fontRefreshes = 0;
    disposed = false;
    /* What the client asked to find last; null once it ended the find. */
    findQuery: EditorFindQuery | null = null;
    findState: EditorFindState = { count: 0, current: null };
    private text: string;
    private readonly changes = new Set<Listener>();
    private readonly saves = new Set<Listener>();
    private readonly blurs = new Set<Listener>();
    private readonly finds = new Set<(state: EditorFindState) => void>();

    constructor(element: HTMLElement, options: EditorOptions) {
        this.element = element;
        this.text = options.text;
        this.language = options.language;
        this.path = options.path;
        this.wrap = options.wrap ?? false;
        this.indentation = options.indentation ?? { tabSize: 4, insertSpaces: true };
        this.theme = options.theme;
        this.readOnly = options.readOnly ?? false;
        this.readOnlyReason = options.readOnlyReason;
        this.revealedLine = options.line ?? null;
        this.column = options.column ?? null;
        this.scrollTop = options.scrollTop ?? null;
    }

    /* A person's edit: the text changes and every change listener hears it. A read-only editor refuses it, as the real editor does. */
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

    /* Counts plain occurrences only; the matcher itself is the editor's, and a test here is about the client's side. */
    find(query: EditorFindQuery | null): void {
        this.findQuery = query;
        const needle = query === null || query.text === '' ? '' : query.caseSensitive ? query.text : query.text.toLowerCase();
        const haystack = query?.caseSensitive === true ? this.text : this.text.toLowerCase();
        const count = needle === '' ? 0 : haystack.split(needle).length - 1;
        this.announceFind({ count, current: count === 0 ? null : 0 });
    }

    findStep(direction: 1 | -1): void {
        const { count, current } = this.findState;
        if (count > 0) {
            this.announceFind({ count, current: ((current ?? 0) + direction + count) % count });
        }
    }

    onFind(listener: (state: EditorFindState) => void): () => void {
        this.finds.add(listener);
        return () => {
            this.finds.delete(listener);
        };
    }

    endFind(): void {
        this.find(null);
    }

    setWrap(wrap: boolean): void {
        this.wrap = wrap;
    }

    /* What the client handed it last; null while it reads the structure itself. */
    blocks: readonly EditorBlock[] | null = null;
    private readonly scopes = new Set<(scope: readonly EditorBlock[]) => void>();

    /* What the client marked as changed last. */
    changeMarks: readonly EditorChangeMark[] = [];

    setChangeMarks(marks: readonly EditorChangeMark[]): void {
        this.changeMarks = marks;
    }

    setBlocks(blocks: readonly EditorBlock[] | null): void {
        this.blocks = blocks;
    }

    onScope(listener: (scope: readonly EditorBlock[]) => void): () => void {
        this.scopes.add(listener);
        return () => {
            this.scopes.delete(listener);
        };
    }

    /* The caret moving into blocks, for a test of what the client draws from it. */
    enterScope(scope: readonly EditorBlock[]): void {
        for (const listener of [...this.scopes]) {
            listener(scope);
        }
    }

    setIndentation(indentation: EditorIndentation): void {
        this.indentation = indentation;
    }

    setTheme(theme: EditorTheme): void {
        this.theme = theme;
    }

    refreshFont(): void {
        this.fontRefreshes += 1;
    }

    setReadOnly(readOnly: boolean, reason?: string): void {
        this.readOnly = readOnly;
        this.readOnlyReason = reason;
    }

    focus(): void {
        this.focused = true;
    }

    dispose(): void {
        this.disposed = true;
        this.changes.clear();
        this.saves.clear();
        this.blurs.clear();
        this.finds.clear();
        this.scopes.clear();
    }

    private announceFind(state: EditorFindState): void {
        this.findState = state;
        for (const listener of [...this.finds]) {
            listener(state);
        }
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
