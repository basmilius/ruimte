/* A Shiki theme id, the one the viewer draws the same file in. */
export type EditorTheme = string;

export interface EditorOptions {
    readonly text: string;
    /* The Shiki id `fs.read` answers with. Without one, or with one Shiki does not know, it is plain text. */
    readonly language?: string;
    /* The file's path, absolute or only a name. A language service reads the dialect off its extension, a `.tsx` from a `.ts`. */
    readonly path?: string;
    readonly theme: EditorTheme;
    readonly readOnly?: boolean;
    /* What a person is told on typing into a read-only editor. */
    readonly readOnlyReason?: string;
    readonly wrap?: boolean;
    /* The width of a tab stop, and whether Tab inserts spaces; 4 and spaces without them. */
    readonly indentation?: EditorIndentation;
    /* One-based, the line the cursor opens on. */
    readonly line?: number;
    /* One-based, where on that line. */
    readonly column?: number;
    /* In pixels, where the view opens; without it the cursor's line is brought into view. */
    readonly scrollTop?: number;
}

/* A part of the document with a header line, such as a function, a class or a method. */
export interface EditorBlock {
    /* One-based, the line its header is on. */
    readonly startLine: number;
    /* One-based, the last line, inclusive. */
    readonly endLine: number;
    /* What a breadcrumb calls it; without one the header's own text stands in. */
    readonly name?: string;
    /* A hint for the icon beside the name, such as `function`, `class` or `method`. */
    readonly kind?: string;
}

export type EditorChangeKind = 'added' | 'modified' | 'deleted';

/* A stretch of lines that differs from the version the host compares against, drawn in the gutter and in the scroll track. */
export interface EditorChangeMark {
    readonly kind: EditorChangeKind;
    /* One-based. For `deleted` the line the removed lines were above, which is where the mark sits. */
    readonly startLine: number;
    /* One-based and inclusive; the same as `startLine` for `deleted`. */
    readonly endLine: number;
}

/* A place in the text as a language server names it: a zero-based line and a UTF-16 character. */
export interface EditorPosition {
    readonly line: number;
    readonly character: number;
}

export interface EditorRange {
    readonly start: EditorPosition;
    readonly end: EditorPosition;
}

/* The range replaced, in the text as it stands after the changes listed before this one, and what takes its place. */
export interface EditorContentChange {
    readonly range: EditorRange;
    readonly text: string;
}

export interface EditorTextChange {
    /* In order, so a language server can follow them one by one. */
    readonly changes: readonly EditorContentChange[];
}

export interface EditorIndentation {
    readonly tabSize: number;
    readonly insertSpaces: boolean;
}

/* What a find bar asks the editor; the editor's own matcher reads it. */
export interface EditorFindQuery {
    readonly text: string;
    readonly caseSensitive: boolean;
    readonly wholeWord: boolean;
    readonly regex: boolean;
}

export interface EditorFindState {
    readonly count: number;
    /* Zero-based; null without a match. */
    readonly current: number | null;
}

export interface Editor {
    getText(): string;
    /* A change from outside, such as a reload after `fs.changed` or another surface's edit. It is never
       reported as a change, and the cursor and the scroll stay put wherever the text around them did. */
    setText(text: string): void;
    onChange(listener: () => void): () => void;
    /* Every change of the text, `setText` and undo included, with what changed in the positions a language server expects. */
    onTextChange(listener: (change: EditorTextChange) => void): () => void;
    /* An offset past the end, or a character past the end of its line, lands on the end. */
    positionAt(offset: number): EditorPosition;
    offsetAt(position: EditorPosition): number;
    /* Mod+S from inside the editor; what happens then is the client's. */
    onSave(listener: () => void): () => void;
    /* The focus left the editor and every widget of its own, such as its suggestions. */
    onBlur(listener: () => void): () => void;
    revealLine(line: number): void;
    /* Marks every match and moves to the first one from the cursor on; null takes the marks away. The
       count comes back through `onFind`, and again whenever an edit changes it. */
    find(query: EditorFindQuery | null): void;
    findStep(direction: 1 | -1): void;
    /* Replaces the match the find is on, with `$1` and the like expanded for a regular expression, and moves to the next one. False when there is none or the editor is read only. */
    replace(replacement: string): boolean;
    /* Replaces every match in one undo step, and says how many there were. */
    replaceAll(replacement: string): number;
    onFind(listener: (state: EditorFindState) => void): () => void;
    /* Takes the marks away and selects the match the find was on, so the cursor is where it stopped. */
    endFind(): void;
    setWrap(wrap: boolean): void;
    setIndentation(indentation: EditorIndentation): void;
    /* Marks that follow their lines through edits until the host sets them again. */
    setChangeMarks(marks: readonly EditorChangeMark[]): void;
    /* The blocks sticky scroll and the breadcrumb go by. The editor reads them from brackets and
       indentation until the host has better, such as a language server's symbols; null goes back. */
    setBlocks(blocks: readonly EditorBlock[] | null): void;
    /* The named blocks around the caret, outermost first, said again only when they change. */
    onScope(listener: (scope: readonly EditorBlock[]) => void): () => void;
    setTheme(theme: EditorTheme): void;
    /* Reads the code face off the page again, after the page changed its size, family or ligatures. */
    refreshFont(): void;
    setReadOnly(readOnly: boolean, reason?: string): void;
    focus(): void;
    dispose(): void;
}

export interface EditorEngine {
    /* The element is sized by its parent; the editor follows it. It must sit under `styles.css`, whose tokens color the chrome. */
    mount(element: HTMLElement, options: EditorOptions): Editor;
}

/* A shortcut as the client writes it (`ui/shortcut.ts`): `mod` is Cmd on macOS and Ctrl elsewhere, `ctrl` and `meta` the physical keys. */
export interface KeyChord {
    readonly mod: boolean;
    readonly ctrl: boolean;
    readonly meta: boolean;
    readonly alt: boolean;
    readonly shift: boolean;
    /* An uppercase letter, a digit, a punctuation mark or a named key such as `ArrowLeft`. */
    readonly key: string;
}

/* One stretch of a colored line. The tokens of a line add up to its length. */
export interface LineToken {
    readonly length: number;
    /* Any CSS color; empty for the editor's own text color. */
    readonly color: string;
    /* Bit flags as Shiki writes them: 1 italic, 2 bold, 4 underline, 8 strikethrough. */
    readonly fontStyle: number;
}

export interface TokenizedLine {
    readonly tokens: readonly LineToken[];
    /* What the next line starts from; only the tokenizer that made it reads it. */
    readonly state: unknown;
}

/*
 * The coloring seam. A grammar needs the state the line before it ended in, so an edit recolors from
 * the changed line on, and stops as soon as a line ends in the state it ended in before.
 */
export interface LineTokenizer {
    /* A null state starts the document. */
    tokenizeLine(text: string, state: unknown): TokenizedLine;
    sameState(a: unknown, b: unknown): boolean;
}

/* A tokenizer for a language in a theme, or null when there is no grammar for it. May load the grammar, so it is async. */
export type TokenizerSource = (language: string | undefined, theme: EditorTheme) => Promise<LineTokenizer | null>;

export interface SmartEditorEngineOptions {
    readonly tokenizer: TokenizerSource;
    /* The app's shortcuts that work from anywhere, a text field included; the editor lets them pass untouched. */
    readonly handBack?: readonly KeyChord[];
    /* Whether the physical Ctrl and Meta of a shortcut are macOS's. */
    readonly apple?: boolean;
}
