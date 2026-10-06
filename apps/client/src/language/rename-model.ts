import type { EditorPosition, EditorRange } from '@adecore/editor';
import type { Location, PrepareRenameResult, TextEdit, WorkspaceEdit } from '@adecore/lsp';
import { isIdentifierCharacter } from './completion-model';
import { entriesOf } from './workspace-edit';

/* The identifier the caret is in or touches; null where there is none. */
export function wordRangeAt(lineText: string, position: EditorPosition): EditorRange | null {
    let start = Math.min(position.character, lineText.length);
    let end = start;
    while (start > 0 && isIdentifierCharacter(lineText[start - 1]!)) {
        start--;
    }
    while (end < lineText.length && isIdentifierCharacter(lineText[end]!)) {
        end++;
    }
    return start === end ? null : { start: { line: position.line, character: start }, end: { line: position.line, character: end } };
}

/* What a server said about renaming at a position: the range to put the input over, and the name it starts with. */
export interface RenameTarget {
    readonly range: EditorRange;
    readonly placeholder: string;
}

/*
 * The target of a prepare answer. A server that answers with a bare range or the default behavior leaves
 * the name to the text, and one that answers null says nothing here can be renamed.
 */
export function renameTargetOf(
    result: PrepareRenameResult,
    textOf: (range: EditorRange) => string,
    wordAtCaret: () => EditorRange | null
): RenameTarget | null {
    if (result === null) {
        return null;
    }
    if ('placeholder' in result) {
        return { range: result.range, placeholder: result.placeholder };
    }
    if ('start' in result) {
        return { range: result, placeholder: textOf(result) };
    }
    const word = wordAtCaret();
    return word === null ? null : { range: word, placeholder: textOf(word) };
}

/* Where the places of one name are, in the open file and in how many files all together. */
export interface Occurrences {
    readonly inFile: readonly EditorRange[];
    readonly count: number;
    readonly files: number;
}

export function occurrencesOf(locations: readonly Location[], uri: string): Occurrences {
    return {
        inFile: locations.filter((location) => location.uri === uri).map((location) => location.range),
        count: locations.length,
        files: new Set(locations.map((location) => location.uri)).size
    };
}

/* One line a rename changes: the line as it is and as it will be. */
export interface RenameRow {
    /* One-based. */
    readonly line: number;
    readonly before: string;
    readonly after: string;
}

export interface RenameFile {
    readonly uri: string;
    readonly rows: readonly RenameRow[];
}

function lineStarts(text: string): number[] {
    const starts = [0];
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        if (code === 13 && text.charCodeAt(index + 1) === 10) {
            index++;
            starts.push(index + 1);
        } else if (code === 10 || code === 13) {
            starts.push(index + 1);
        }
    }
    return starts;
}

/* The lines of a file an edit touches, each once, as they read before and after. An edit across lines is shown from its first line. */
export function renameRowsOf(text: string, edits: readonly TextEdit[]): RenameRow[] {
    const starts = lineStarts(text);
    const lineAt = (line: number): { from: number; to: number } => {
        const from = starts[line] ?? text.length;
        let to = (starts[line + 1] ?? text.length + 1) - 1;
        while (to > from && (text[to - 1] === '\n' || text[to - 1] === '\r')) {
            to--;
        }
        return { from, to: Math.min(to, text.length) };
    };
    const byLine = new Map<number, TextEdit[]>();
    for (const edit of edits) {
        byLine.set(edit.range.start.line, [...(byLine.get(edit.range.start.line) ?? []), edit]);
    }
    return [...byLine]
        .sort((left, right) => left[0] - right[0])
        .map(([line, own]) => {
            const { from, to } = lineAt(line);
            const before = text.slice(from, to);
            let after = before;
            for (const edit of [...own].sort((left, right) => right.range.start.character - left.range.start.character)) {
                const end = edit.range.end.line === line ? edit.range.end.character : before.length;
                after = after.slice(0, edit.range.start.character) + edit.newText + after.slice(end);
            }
            return { line: line + 1, before, after };
        });
}

/* Every file of a rename with the lines it changes, for the preview; `textOf` reads a file that is not open. Null when the edit renames files too. */
export async function renamePreviewOf(edit: WorkspaceEdit, textOf: (uri: string) => Promise<string | null>): Promise<RenameFile[] | null> {
    const entries = entriesOf(edit);
    if (entries === null) {
        return null;
    }
    const files: RenameFile[] = [];
    for (const [uri, list] of entries) {
        const text = await textOf(uri);
        files.push({ uri, rows: text === null ? [] : renameRowsOf(text, list.flat()) });
    }
    return files;
}
