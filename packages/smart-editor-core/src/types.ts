/* Offsets are UTF-16 code units from the start of the document. */
export interface Selection {
    anchor: number;
    head: number;
}

/* A replacement of `[from, to)`. A batch of edits is simultaneous, in the coordinates of the document before it. */
export interface TextEdit {
    from: number;
    to: number;
    text: string;
}

/* A replaced range in the coordinates of the document before the change, with the length that took its place. */
export interface DocumentChange {
    from: number;
    to: number;
    insertedLength: number;
}

/* Zero-based line and UTF-16 column. */
export interface Position {
    line: number;
    column: number;
}

/* A replacement as a language server's `didChange` wants it: a range of the document as it stands after the edits listed before this one. */
export interface ContentEdit {
    start: Position;
    end: Position;
    text: string;
}

export interface Disposable {
    dispose(): void;
}

export type ChangeSource = 'input' | 'command' | 'external';

export interface EditorSnapshot {
    /* Flattened on first read, so a listener that only needs the selection never pays for it. */
    text: string;
    selections: readonly Selection[];
    revision: number;
    canUndo: boolean;
    canRedo: boolean;
    /* One entry per transaction, present when the text changed. */
    changes?: readonly (readonly DocumentChange[])[];
    /* The same change in order, as a sequence a language server can follow; present when the text changed. */
    contentEdits?: readonly ContentEdit[];
    source?: ChangeSource;
}

export interface EditOptions {
    /* Selections after the edit. Without them the current ones are mapped through the edits. */
    selections?: readonly Selection[];
    source?: ChangeSource;
    /* Edits with the same group join one undo step until a selection change or an undo closes it. */
    historyGroup?: string;
}

export type EditorCommand =
    | 'undo'
    | 'redo'
    | 'selectAll'
    | 'smartHome'
    | 'smartEnd'
    | 'selectSmartHome'
    | 'selectSmartEnd'
    | 'wordLeft'
    | 'wordRight'
    | 'selectWordLeft'
    | 'selectWordRight'
    | 'deleteWordLeft'
    | 'deleteWordRight'
    | 'camelLeft'
    | 'camelRight'
    | 'selectCamelLeft'
    | 'selectCamelRight'
    | 'deleteCamelLeft'
    | 'deleteCamelRight'
    | 'expandSelection'
    | 'shrinkSelection'
    | 'smartBackspace'
    | 'deleteForward'
    | 'duplicateLine'
    | 'deleteLine'
    | 'moveLineUp'
    | 'moveLineDown'
    | 'toggleLineComment'
    | 'toggleBlockComment'
    | 'insertTab'
    | 'indent'
    | 'outdent'
    | 'insertNewline'
    | 'startNewLine'
    | 'startNewLineBefore'
    | 'splitLine'
    | 'joinLines'
    | 'toggleCase'
    | 'autoIndentLines'
    | 'addCaretAbove'
    | 'addCaretBelow'
    | 'selectNextOccurrence'
    | 'unselectOccurrence'
    | 'selectAllOccurrences'
    | 'addCaretPerSelectedLine';

export interface CommandOptions {
    /* Clamped to 1 through 16. */
    tabSize?: number;
    insertSpaces?: boolean;
    /* Replaces the line comment marker of the language. */
    commentToken?: string;
    /* Whether the plain word commands stop at camel humps. Off unless true; the explicit camel commands always do. */
    camelCase?: boolean;
    /* Turns pairing off for brackets and quotes at once; the two below turn off one of them. */
    autoClosingPairs?: boolean;
    autoClosingBrackets?: boolean;
    autoClosingQuotes?: boolean;
    /* A bracket or quote typed over a selection wraps it. On unless false. */
    surroundSelection?: boolean;
    /* A language id such as `typescript` or `php`; it decides what counts as a comment or a string. */
    language?: string;
    smartSemicolon?: boolean;
    /* Tab steps over a closer the editor inserted. On unless false. */
    tabOutOfClosers?: boolean;
    /* Enter computes the indentation of the new line, continues comments and closes braces. On unless false. */
    smartEnter?: boolean;
    /* A pasted block moves to the indentation of the line it lands on. On unless false. */
    indentOnPaste?: boolean;
    /* Where the row of the screen an offset is on starts and ends, so Home and End go by wrapped rows. Without it a line is one row. */
    visualLine?: (offset: number) => { start: number; end: number };
    /*
     * The lines that stand on one row of the screen: a collapsed fold is a row, from its first line to its last.
     * Line commands act on the whole row, a word move treats it as one stop and an added caret skips its inside.
     */
    lineSpan?: (line: number) => { first: number; last: number };
    /* Told which lines a move went to (`from` before, `to` after), so a host can take what it keeps by line along. */
    onLinesMoved?: (moves: readonly { from: number; to: number }[]) => void;
}
