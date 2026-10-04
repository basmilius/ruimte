import type { EditorCommand } from '@ruimte/smart-editor-core';

export type { EditorCommand };

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
    /* What it does as a person types; whatever is left out is on, except the camel humps. */
    readonly smartKeys?: Partial<EditorSmartKeys>;
    /* One-based, the line the cursor opens on. */
    readonly line?: number;
    /* One-based, where on that line. */
    readonly column?: number;
    /* In pixels, where the view opens; without it the cursor's line is brought into view. */
    readonly scrollTop?: number;
}

/* What the editor does by itself as a person types. Every one is on, except the camel humps. */
export interface EditorSmartKeys {
    /* A typed bracket brings its closer, and typing the closer goes over it. */
    readonly autoPairBrackets: boolean;
    readonly autoPairQuotes: boolean;
    /* A bracket or quote typed over a selection wraps it. */
    readonly surroundSelection: boolean;
    /* Tab steps over a closer the editor added. */
    readonly tabOutOfClosers: boolean;
    /* Enter works out the indentation of the new line, continues comments and closes braces. */
    readonly smartIndentOnEnter: boolean;
    /* A pasted block moves to the indentation of the line it lands on. */
    readonly indentOnPaste: boolean;
    /* A `;` typed inside a call goes to the end of the statement. */
    readonly smartSemicolon: boolean;
    /* Moving by word also stops inside `camelCase` and `snake_case` words. Off. */
    readonly camelHumps: boolean;
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
    /* A person typing, one of the editor's own commands such as undo, or a change from outside. */
    readonly source: 'input' | 'command' | 'external';
}

export type EditorMarkerSeverity = 'error' | 'warning' | 'info' | 'hint';

/* A range the host wants drawn as a problem: a squiggle in the text, a tick in the scroll track. It follows its text through edits until the host sets the markers again. */
export interface EditorMarker {
    readonly range: EditorRange;
    readonly severity: EditorMarkerSeverity;
    /* Drawn faded, for code nothing uses. */
    readonly unnecessary?: boolean;
    /* Drawn struck through. */
    readonly deprecated?: boolean;
    /* What the tick of this problem in the scroll track says when the pointer rests on it, and a press on the tick goes to the problem. */
    readonly message?: string;
}

/* The kind of use a highlighted name has at the caret. */
export type EditorHighlightKind = 'text' | 'read' | 'write';

export interface EditorHighlight {
    readonly range: EditorRange;
    readonly kind: EditorHighlightKind;
}

/* A box on the screen, in the page's pixels, so a popup placed by it is right on a canvas at any zoom. */
export interface EditorRect {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

/* The pointer rests on a character of the text. */
export interface EditorHover {
    readonly position: EditorPosition;
    readonly rect: EditorRect;
}

/* A press of the primary button on a character of the text. */
export interface EditorClick {
    readonly position: EditorPosition;
    /* Cmd on macOS, Ctrl elsewhere. */
    readonly mod: boolean;
    readonly alt: boolean;
    readonly shift: boolean;
}

/* Returns true when the click was taken; the editor then leaves the caret and the selection where they are. */
export type EditorClickHandler = (click: EditorClick) => boolean;

/* A request for the context menu, by the secondary button or its key, which the editor does not answer itself. */
export interface EditorContextMenu {
    /* The character under the pointer, or the end of the line it is past. */
    readonly position: EditorPosition;
    /* Whether it lies in the selection, so the host knows whether to leave the selection alone. */
    readonly inSelection: boolean;
    /* In the page's pixels. */
    readonly x: number;
    readonly y: number;
}

/* A row of the host's own DOM under a line of the text, such as the references of a name. It is not part of the document. */
export interface EditorWidget {
    readonly id: string;
    /* Zero-based; the widget sits under this line and stays there only as long as the host does not set the widgets again. */
    readonly line: number;
    /* The height the row has until it has been measured. */
    readonly height?: number;
    /* Fills the element the row is drawn in, which the editor makes again whenever the row scrolls back into view. */
    render(container: HTMLElement): void;
}

/* Returns true when the key was taken; the editor then prevents its default and does nothing else with it. */
export type EditorKeyHandler = (event: KeyboardEvent) => boolean;

/* A range of text the language servers classified, by the TextMate scopes the editor's theme colors it by. */
export interface EditorSemanticToken {
    readonly line: number;
    readonly character: number;
    readonly length: number;
    /* Outermost first, as a grammar would have reported them. */
    readonly scopes: readonly string[];
}

/* How a theme draws a piece of code. The font style is Shiki's flags: 1 italic, 2 bold, 4 underline, 8 strikethrough. */
export interface ScopeStyle {
    readonly color: string;
    readonly fontStyle: number;
}

/* What the current theme draws a scope stack in, or undefined where it says nothing and the grammar's color stays. */
export type ScopeColors = (scopes: readonly string[]) => ScopeStyle | undefined;

/* The scope colors of a theme, or null when there is none. May load the theme, so it is async. */
export type ScopeColorSource = (theme: EditorTheme) => Promise<ScopeColors | null>;

/* Text drawn between two characters of a line, such as the type of a variable or the name of a parameter. It is not part of the document. */
export interface EditorInlayHint {
    readonly position: EditorPosition;
    readonly label: string;
}

/* A button in the gutter on one line, such as the lightbulb that offers code actions. */
export interface EditorGutterAction {
    /* Zero-based. */
    readonly line: number;
    readonly label: string;
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
    /* Only the text that was selected when this turned on is searched, however the selection moves after. */
    readonly inSelection?: boolean;
}

export interface EditorFindState {
    readonly count: number;
    /* Zero-based; null without a match. */
    readonly current: number | null;
    /* The search is in the selection and nothing was selected. */
    readonly noSelection?: boolean;
}

export interface EditorReplaceOptions {
    /* The replacement takes the case of the text it replaces: `Foo` becomes `Bar`, `FOO` becomes `BAR`. */
    readonly preserveCase?: boolean;
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
    /* The text of a range, such as the word before the caret. */
    textInRange(range: EditorRange): string;
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
    replace(replacement: string, options?: EditorReplaceOptions): boolean;
    /* Replaces every match in one undo step, and says how many there were. */
    replaceAll(replacement: string, options?: EditorReplaceOptions): number;
    /* What a regular expression replacement writes for the match the find is on, drawn under it while the find is open; null takes it away. */
    setReplacePreview(replacement: string | null, options?: EditorReplaceOptions): void;
    /* Ends the find with a caret on every match, the one the find was on last, and says how many there were. */
    selectFindMatches(): number;
    /* Selects the next match of a query from the cursor, or the one before, going round at the ends, without a find bar. False when there is none. */
    findFromCursor(query: EditorFindQuery, direction: 1 | -1): boolean;
    onFind(listener: (state: EditorFindState) => void): () => void;
    /* Takes the marks away and selects the match the find was on, so the cursor is where it stopped. */
    endFind(): void;
    setWrap(wrap: boolean): void;
    setIndentation(indentation: EditorIndentation): void;
    /* Changes what it does as a person types; the keys left out stay as they are. */
    setSmartKeys(keys: Partial<EditorSmartKeys>): void;
    /* Marks that follow their lines through edits until the host sets them again. */
    setChangeMarks(marks: readonly EditorChangeMark[]): void;
    /* The blocks sticky scroll and the breadcrumb go by. The editor reads them from brackets and
       indentation until the host has better, such as a language server's symbols; null goes back. */
    setBlocks(blocks: readonly EditorBlock[] | null): void;
    /* The named blocks around the caret, outermost first, said again only when they change. */
    onScope(listener: (scope: readonly EditorBlock[]) => void): () => void;
    /* Problems to draw, replacing the ones set before. */
    setMarkers(markers: readonly EditorMarker[]): void;
    /* The other uses of the name at the caret, drawn as soft marks until the next edit. */
    setHighlights(highlights: readonly EditorHighlight[]): void;
    /* A range drawn as a link, underlined with the pointer on it, until the host sets another or the text is edited; null takes it away. */
    setLink(range: EditorRange | null): void;
    /* Colors by what the language servers know, over what the grammar made of the text; null takes them away. */
    setSemanticTokens(tokens: readonly EditorSemanticToken[] | null): void;
    /* Hints to draw as soft pills in the text, replacing the ones set before. They follow their text through edits until set again. */
    setInlayHints(hints: readonly EditorInlayHint[]): void;
    /* One button in the gutter, replacing the one before; null takes it away. It stays on its line until the host sets it again. */
    setGutterAction(action: EditorGutterAction | null): void;
    /* The button was pressed; the zero-based line it is on. */
    onGutterAction(listener: (line: number) => void): () => void;
    getCaret(): EditorPosition;
    /* In pixels, what `scrollTop` on mounting takes back. */
    getScrollTop(): number;
    /* The primary selection, start before end; empty at the caret. */
    getSelection(): EditorRange;
    getIndentation(): EditorIndentation;
    /* Moves the one caret and scrolls it into view. */
    setCaret(position: EditorPosition): void;
    /* Replaces the selections with one over the range, the caret at its end, and scrolls it into view. */
    setSelection(range: EditorRange): void;
    /* The caret moved or the text under it changed. */
    onCaret(listener: (position: EditorPosition) => void): () => void;
    /* The pointer moved onto another character, or null when it left the text. */
    onHover(listener: (hover: EditorHover | null) => void): () => void;
    /* The character cell at a position in screen coordinates, or null where the editor has no layout. */
    rectAt(position: EditorPosition): EditorRect | null;
    /* The lines in view, from the start of the first to the end of the last. */
    getVisibleRange(): EditorRange;
    /* The editor scrolled or changed size, so whatever is placed by `rectAt` is somewhere else. */
    onViewChange(listener: () => void): () => void;
    /* Rows of the host's own DOM under lines of the text, replacing the ones set before. */
    setWidgets(widgets: readonly EditorWidget[]): void;
    /* Handlers see a press of the primary button before the editor does, the first to take it winning. */
    onClick(handler: EditorClickHandler): () => void;
    /* The context menu was asked for. The editor draws none of its own and does not move the caret. */
    onContextMenu(listener: (menu: EditorContextMenu) => void): () => void;
    /* Handlers see a key before the editor does, the first to take it winning. */
    onKeyDown(handler: EditorKeyHandler): () => void;
    /* Replaces ranges of the current text at once, as one step of the undo history. */
    applyEdits(edits: readonly EditorContentChange[]): boolean;
    setTheme(theme: EditorTheme): void;
    /* Reads the code face off the page again, after the page changed its size, family or ligatures. */
    refreshFont(): void;
    setReadOnly(readOnly: boolean, reason?: string): void;
    /* Runs an editing command on every caret, as its key would. False when it changed nothing. */
    runCommand(command: EditorCommand): boolean;
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
    /* Without it semantic tokens are ignored and the grammar's colors stand. */
    readonly scopeColors?: ScopeColorSource;
    /* The app's shortcuts that work from anywhere, a text field included; the editor lets them pass untouched. */
    readonly handBack?: readonly KeyChord[];
    /* Whether the physical Ctrl and Meta of a shortcut are macOS's. */
    readonly apple?: boolean;
}
