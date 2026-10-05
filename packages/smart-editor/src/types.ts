import type { EditorCommand, FoldRole } from '@ruimte/smart-editor-core';

export type { EditorCommand, FoldRole };

export type EditorFoldOutline = 'off' | 'hover' | 'always';

/* The commands that fold, which the view answers since it knows where the ranges are. */
export type EditorViewCommand =
    | 'collapseRegion'
    | 'expandRegion'
    | 'collapseAllRegions'
    | 'expandAllRegions'
    | 'collapseRegionRecursively'
    | 'expandRegionRecursively'
    | 'foldSelection'
    | 'collapseDocComments'
    | 'expandDocComments'
    | 'expandAllToLevel1'
    | 'expandAllToLevel2'
    | 'expandAllToLevel3'
    | 'expandAllToLevel4'
    | 'expandAllToLevel5'
    | 'toggleColumnMode';

/* Everything `runCommand` runs. */
export type EditorRunCommand = EditorCommand | EditorViewCommand;

/* Lines to fold, zero-based. */
export interface EditorFoldRange {
    readonly startLine: number;
    readonly endLine: number;
}

/* What a host keeps of an editor's folds to open the file again as it was left. */
export interface EditorFolds {
    /* The ranges that are folded, the ones made of a selection included. */
    readonly collapsed: readonly EditorFoldRange[];
    /* The ranges made of a selection, folded or not. */
    readonly custom: readonly EditorFoldRange[];
}

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
    /* A line at each indentation level, the one of the scope around the caret stronger; on unless false. */
    readonly guides?: boolean;
    /* Spaces drawn as dots and tabs as arrows; off unless true. */
    readonly whitespace?: boolean;
    /* The column to draw a line at, such as the `max_line_length` of a project; none by default. */
    readonly rightMargin?: number | null;
    /* When the arrow that folds a block shows in the gutter; on hover by default. */
    readonly foldOutline?: EditorFoldOutline;
    /* What the editor says to a person itself, in the host's words. */
    readonly messages?: Partial<EditorMessages>;
    /* The folds a host kept when the file was last open. */
    readonly folds?: EditorFolds;
    /* Without remembered folds, the folds of these roles fold, as they do the first time a file opens, and again as a language server names more of them. */
    readonly foldDefaults?: readonly FoldRole[];
    /* One-based, the line the cursor opens on. */
    readonly line?: number;
    /* One-based, where on that line. */
    readonly column?: number;
    /* In pixels, where the view opens; without it the cursor's line is brought into view. */
    readonly scrollTop?: number;
}

/* The few sentences the editor says on its own. */
export interface EditorMessages {
    /* Select next occurrence went past the last one. */
    readonly noMoreOccurrences: string;
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

/* The range of a symbol and the kind of body it has. */
export interface EditorFoldSymbol {
    readonly range: EditorRange;
    /* `value` is a variable or property, which has a function body when its initializer is a function. */
    readonly body: 'function' | 'method' | 'class' | 'value';
}

export interface EditorFoldHints {
    readonly symbols?: readonly EditorFoldSymbol[];
    readonly ranges?: readonly (EditorFoldRange & { readonly kind?: string })[];
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

/*
 * A color for what an agent did: the name of a custom property of the page (`--agent-1`, see
 * `AGENT_COLORS`), which follows the theme, or any CSS color.
 */
export type EditorMarkColor = string;

/*
 * A run of lines drawn as a bar in the gutter, three pixels wide beside the line numbers where the change
 * marks are. Where a line has both, the bar stands in the place of the change mark, which the scroll
 * track still shows. It follows its text through edits until the host sets the marks again.
 */
export interface EditorAttributionMark {
    /* What `onAttributionHover` says when the pointer is on the bar. */
    readonly id: string;
    /* One-based, as for the change marks. */
    readonly startLine: number;
    /* One-based and inclusive; a line past the end is the last one. */
    readonly endLine: number;
    readonly color: EditorMarkColor;
}

/* An agent's caret with its name, drawn above the text where it is writing; the editor's own caret and selection never move for it. */
export interface EditorRemoteCursor {
    readonly id: string;
    /* A line past the end is the last one, a character past the end of its line is the end of it. */
    readonly position: EditorPosition;
    /* What the label says, such as the agent's name. */
    readonly name: string;
    readonly color: EditorMarkColor;
}

/* Lines tinted behind the text, such as the lines an agent changed in a review. */
export interface EditorLineHighlight {
    /* One-based and inclusive, as for the change marks. */
    readonly startLine: number;
    readonly endLine: number;
    /* The tint is this color at a low alpha, so the code keeps its colors on it in either theme. */
    readonly color: EditorMarkColor;
    /* A color the rows are filled with as it stands, instead of the low alpha tint of `color`, which keeps naming the sign's color. A custom property name or any CSS color. */
    readonly fill?: EditorMarkColor;
    /* A character in the gutter of each line, such as `+`, in the same color. */
    readonly sign?: string;
}

/* How `renderCode` draws lines that are not part of the document. */
export interface EditorCodeBlockOptions {
    /* One-based number of the first line, shown in the gutter column; without it the lines have none. */
    readonly firstLine?: number;
    /* A character in the gutter of each line, such as `-`. */
    readonly sign?: string;
    /* Tints the rows and draws the bar beside them, as a highlight and an attribution mark do for lines of the document. */
    readonly color?: EditorMarkColor;
    /* Per line, the character ranges (UTF-16, end exclusive) drawn with a stronger tint of `color`, such as the words a change replaced. */
    readonly emphasis?: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
    /* Draws the text a little faded, as lines that are gone. */
    readonly faded?: boolean;
}

/* The pointer is on the bar of a run. */
export interface EditorAttributionHover {
    readonly id: string;
    /* The bar on the line under the pointer, in the page's pixels, so a card placed by it is right at any canvas zoom. */
    readonly rect: EditorRect;
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
    /* Zero-based; the widget sits next to this line and stays there only as long as its owner does not set its widgets again. */
    readonly line: number;
    /* Under the line by default; `above` puts the row over it, which a row at the top of the file needs. */
    readonly placement?: 'above' | 'below';
    /* The height the row has until it has been measured. */
    readonly height?: number;
    /* Fills the element the row is drawn in, which the editor makes again whenever the row scrolls back into view. */
    render(container: HTMLElement): void;
}

/*
 * The host's own DOM after the last character of a line of the text, such as the buttons of a change
 * under review. It is not part of the document and not part of the row, so it takes no height and
 * moves nothing.
 */
export interface EditorLineAction {
    readonly id: string;
    /* Zero-based; the action stays on its line through edits until its owner sets its actions again. */
    readonly line: number;
    /* Fills the element once; it is kept for as long as the action is. */
    render(container: HTMLElement): void;
}

/* One thing a code vision row says, such as how many times a declaration is used. */
export interface EditorCodeVisionEntry {
    readonly id: string;
    readonly text: string;
    /* A person for one author, several for more. */
    readonly icon?: 'user' | 'users';
    /* The entry was pressed; `anchor` is where it stands, in the page's pixels, for what opens beside it. */
    activate(anchor: EditorRect): void;
}

/*
 * A quiet row above a declaration, in the declaration's indentation and one code line high. A row with
 * no entries yet still holds its height, so the text does not move when they arrive.
 */
export interface EditorCodeVision {
    readonly id: string;
    /* Zero-based line of the declaration; the row sits above it and follows it through edits until the host sets the rows again. */
    readonly line: number;
    readonly entries: readonly EditorCodeVisionEntry[];
}

/* Returns true when the key was taken; the editor then prevents its default and does nothing else with it. */
export type EditorKeyHandler = (event: KeyboardEvent) => boolean;

/*
 * The ranges a language server knows around each position asked, the smallest first and each larger than
 * the one before; null when it has none to give, which sends Extend Selection to the editor's own rule.
 */
export type EditorSelectionRanges = (positions: readonly EditorPosition[]) => Promise<readonly (readonly EditorRange[])[] | null>;

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

/* A small button in the gutter on one line that the host keeps apart from the code action, such as the mark of a saved inline edit. */
export interface EditorGutterMarker {
    /* What `onGutterMarker` says when it is pressed. */
    readonly id: string;
    /* Zero-based; it stays on this line until the host sets its markers again. */
    readonly line: number;
    readonly label: string;
}

/*
 * How the view follows a caret that was moved from outside. `relative` keeps it in view with a line
 * of margin, `center` puts a target out of view a third from the top and leaves one in view alone, and
 * `centerDown` and `centerUp` do the same for a step through results that goes one way, so each next one
 * lands where the eye expects it.
 */
export type EditorReveal = 'relative' | 'center' | 'centerDown' | 'centerUp';

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

/*
 * A range that follows the text through edits. `get` is the range where it is now, or null once an edit
 * touched it: one that replaces text inside it or lands strictly between its ends. Text inserted exactly
 * at an end leaves the text of the range as it was, so the range survives it, moving behind text inserted
 * at its start and staying put for text inserted at its end. A disposed range is null.
 */
export interface EditorTrackedRange {
    get(): EditorRange | null;
    dispose(): void;
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
    /* Puts the cursor at the start of a one-based line and scrolls it into view, a third from the top when it was out of view. */
    revealLine(line: number, reveal?: EditorReveal): void;
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
    setGuides(guides: boolean): void;
    setWhitespace(whitespace: boolean): void;
    /* The column to draw a line at; null takes it away. */
    setRightMargin(column: number | null): void;
    setFoldOutline(outline: EditorFoldOutline): void;
    /* What a language server knows about the folds: the bodies of symbols and the ranges it folds. They follow their text through edits until set again; null forgets them. */
    setFoldHints(hints: EditorFoldHints | null): void;
    /* Marks that follow their lines through edits until the host sets them again. */
    setChangeMarks(marks: readonly EditorChangeMark[]): void;
    /* The blocks sticky scroll and the breadcrumb go by. The editor reads them from brackets and
       indentation until the host has better, such as a language server's symbols; null goes back. */
    setBlocks(blocks: readonly EditorBlock[] | null): void;
    /* The named blocks around the caret, outermost first, said again only when they change. */
    onScope(listener: (scope: readonly EditorBlock[]) => void): () => void;
    /* Bars in the gutter for the lines an agent wrote, replacing the ones set before. */
    setAttributionMarks(marks: readonly EditorAttributionMark[]): void;
    /*
     * Carets of agents with their names, replacing the ones set before. Each follows its text through
     * edits until the host sets them again, takes no pointer and sits over the text, with the name above
     * the caret or under it where the view has no room above.
     */
    setRemoteCursors(cursors: readonly EditorRemoteCursor[]): void;
    /* Lines tinted behind the text, replacing the ones set before. They follow their text through edits until set again, and cost one mapping of two offsets per highlight. */
    setLineHighlights(highlights: readonly EditorLineHighlight[]): void;
    /*
     * Fills a widget row's element with lines of code that are not in the document, such as the lines an
     * agent removed, in the editor's face and colors for the language, a gutter column as wide as the
     * editor's and a row as high as a line. Call it from `EditorWidget.render`.
     */
    renderCode(container: HTMLElement, text: string, options?: EditorCodeBlockOptions): void;
    /* The pointer rests on a bar, or null when it left it or the bar is gone. */
    onAttributionHover(listener: (hover: EditorAttributionHover | null) => void): () => void;
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
    /* The markers of one owner (`default` without one), replacing the ones it set before and leaving every other owner's alone. An empty list takes them away. */
    setGutterMarkers(markers: readonly EditorGutterMarker[], owner?: string): void;
    /* A marker was pressed; its id. */
    onGutterMarker(listener: (id: string) => void): () => void;
    getCaret(): EditorPosition;
    /* In pixels, what `scrollTop` on mounting takes back. */
    getScrollTop(): number;
    /* Which lines are folded, for `folds` on mounting. */
    getFolds(): EditorFolds;
    /* The primary selection, start before end; empty at the caret. */
    getSelection(): EditorRange;
    /* Every selection, the primary one last. */
    getSelections(): EditorRange[];
    getIndentation(): EditorIndentation;
    /* Moves the one caret and scrolls it into view. */
    setCaret(position: EditorPosition, reveal?: EditorReveal): void;
    /* Replaces the selections with one over the range, the caret at its end, and scrolls it into view. */
    setSelection(range: EditorRange, reveal?: EditorReveal): void;
    /* Replaces the selections with these, in the order given: the last is the primary one, as for the newest caret, and is scrolled into view. An empty list changes nothing. */
    setSelections(ranges: readonly EditorRange[], reveal?: EditorReveal): void;
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
    /*
     * Rows of the host's own DOM next to lines of the text, replacing the ones the same owner set before.
     * Owners never take each other's rows away, so a peek, the review of an agent's change and a conflict
     * can all be up at once. Without an owner the rows are `default`'s. Rows next to the same line stand
     * in the order of their owners' names, and within an owner in the order it gave them, whichever owner
     * set its rows last. An empty list takes the owner's rows away.
     */
    setWidgets(widgets: readonly EditorWidget[], owner?: string): void;
    /* The actions of one owner (`default` without one), replacing the ones it set before and leaving every other owner's alone. A line that a fold hides has none. */
    setLineActions(actions: readonly EditorLineAction[], owner?: string): void;
    /* The code vision rows above declarations, replacing the ones set before. Separate from the widgets, which they never displace. */
    setCodeVision(rows: readonly EditorCodeVision[]): void;
    /* Handlers see a press of the primary button before the editor does, the first to take it winning. */
    onClick(handler: EditorClickHandler): () => void;
    /* The context menu was asked for. The editor draws none of its own and does not move the caret. */
    onContextMenu(listener: (menu: EditorContextMenu) => void): () => void;
    /* Handlers see a key before the editor does, the first to take it winning. */
    onKeyDown(handler: EditorKeyHandler): () => void;
    /* Extend Selection grows through these ranges, where the host has them, and Shrink Selection walks back; null returns to the editor's own rule. */
    setSelectionRanges(provider: EditorSelectionRanges | null): void;
    /* Follows a range through every change of the text, `setText` and undo included, until it is disposed. Costs one mapping of two offsets per change. */
    trackRange(range: EditorRange): EditorTrackedRange;
    /* Replaces ranges of the current text at once, as one step of the undo history. */
    applyEdits(edits: readonly EditorContentChange[]): boolean;
    setTheme(theme: EditorTheme): void;
    /* Reads the code face off the page again, after the page changed its size, family or ligatures. */
    refreshFont(): void;
    setReadOnly(readOnly: boolean, reason?: string): void;
    /* Runs an editing command on every caret, as its key would. False when it changed nothing. */
    runCommand(command: EditorRunCommand): boolean;
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
    /* True once, when the grammar was rebuilt and the states handed out before it are void. */
    stale?(): boolean;
}

/* A tokenizer for a language in a theme, or null when there is no grammar for it. May load the grammar, so it is async; `text` is the document, for the embedded languages it names. */
export type TokenizerSource = (language: string | undefined, theme: EditorTheme, text?: string) => Promise<LineTokenizer | null>;

export interface SmartEditorEngineOptions {
    readonly tokenizer: TokenizerSource;
    /* Without it semantic tokens are ignored and the grammar's colors stand. */
    readonly scopeColors?: ScopeColorSource;
    /* The app's shortcuts that work from anywhere, a text field included; the editor lets them pass untouched. */
    readonly handBack?: readonly KeyChord[];
    /* Whether the physical Ctrl and Meta of a shortcut are macOS's. */
    readonly apple?: boolean;
}
