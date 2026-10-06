import type { Location, Range } from '@adecore/lsp';

/* A stretch of one line, in characters from its start. */
export interface NameRange {
    readonly start: number;
    readonly end: number;
}

/* One reference in the list: the line it is on, as the file reads there. */
export interface PeekPlace {
    readonly id: string;
    readonly location: Location;
    /* Zero-based. */
    readonly line: number;
    readonly text: string;
    /* Where the name stands in `text`; null without a line, or when the line is not what the server read. */
    readonly name: NameRange | null;
}

export interface PeekFile {
    readonly uri: string;
    readonly places: readonly PeekPlace[];
}

/* The most files whose text is read for the list; a name used everywhere shows the rest as places without a line. */
export const PEEK_READ_FILES = 30;

/* The part of `line` a range covers, which runs to the end of the line when the range goes on. */
function columnsOf(range: Range, line: number, length: number): NameRange | null {
    if (range.start.line !== line) {
        return null;
    }
    const end = Math.min(length, range.end.line === line ? range.end.character : length);
    return range.start.character < end ? { start: range.start.character, end } : null;
}

/* The name of a place within its line once the indentation is cut off. */
function trimmedNameOf(raw: string, range: Range, line: number): NameRange | null {
    const leading = raw.length - raw.trimStart().length;
    const columns = columnsOf(range, line, raw.length);
    const length = raw.trim().length;
    if (columns === null || columns.start < leading || columns.start >= leading + length) {
        return null;
    }
    return { start: columns.start - leading, end: Math.min(length, columns.end - leading) };
}

/*
 * The references grouped by file, the file the peek was opened in first and the others in the order the
 * server gave them, each file's places by line. `textOf` answers null for a file whose text is not at hand.
 */
export function peekFilesOf(locations: readonly Location[], current: string, textOf: (uri: string) => string | null): PeekFile[] {
    const order: string[] = [];
    const byFile = new Map<string, Location[]>();
    for (const location of locations) {
        if (!byFile.has(location.uri)) {
            order.push(location.uri);
            byFile.set(location.uri, []);
        }
        byFile.get(location.uri)!.push(location);
    }
    const uris = [...order.filter((uri) => uri === current), ...order.filter((uri) => uri !== current)];
    return uris.map((uri, fileIndex) => {
        const text = textOf(uri);
        const lines = text === null ? null : text.split(/\r\n|\r|\n/);
        const places = [...byFile.get(uri)!]
            .sort((left, right) => left.range.start.line - right.range.start.line || left.range.start.character - right.range.start.character)
            .map((location, index) => {
                const line = location.range.start.line;
                const raw = lines?.[line] ?? '';
                return {
                    id: `${fileIndex}:${index}`,
                    location,
                    line,
                    text: raw.trim(),
                    name: lines === null ? null : trimmedNameOf(raw, location.range, line)
                };
            });
        return { uri, places };
    });
}

/* A few lines of a file around a line, to draw as the preview of a reference. */
export interface PeekSnippet {
    readonly startLine: number;
    readonly text: string;
    /* Zero-based, from the first line of the snippet. */
    readonly active: number;
    /* The name on the active line, in characters of the line as it stands in `text`. */
    readonly name: NameRange | null;
}

const BEFORE = 3;
const AFTER = 8;

export function snippetOf(text: string, line: number, range: Range): PeekSnippet {
    const lines = text.split(/\r\n|\r|\n/);
    const startLine = Math.max(0, line - BEFORE);
    const end = Math.min(lines.length, line + AFTER + 1);
    return { startLine, text: lines.slice(startLine, end).join('\n'), active: line - startLine, name: columnsOf(range, line, (lines[line] ?? '').length) };
}

const DEFINITION_LINES = 24;

/*
 * The source of a definition: the lines of the whole declaration when the server gave them, else a stretch
 * from just above the name, cut at a screenful since a class is longer than a peek is tall.
 */
export function definitionSnippetOf(text: string, line: number, declaration: Range | null, range: Range): PeekSnippet {
    const lines = text.split(/\r\n|\r|\n/);
    const startLine = declaration === null ? Math.max(0, line - 2) : Math.min(declaration.start.line, line);
    const end = Math.min(lines.length - 1, declaration === null ? line + DEFINITION_LINES / 2 : Math.min(declaration.end.line, startLine + DEFINITION_LINES));
    return { startLine, text: lines.slice(startLine, end + 1).join('\n'), active: line - startLine, name: columnsOf(range, line, (lines[line] ?? '').length) };
}

/*
 * For each path, the trailing folders that tell it from the other paths with the same file name, as few
 * as it takes; empty for a file whose name is its own.
 */
export function distinguishingFolders(paths: readonly string[]): string[] {
    const folders = paths.map((path) => path.split('/').slice(0, -1));
    const names = paths.map((path) => path.slice(path.lastIndexOf('/') + 1));
    return paths.map((path, index) => {
        const same = paths.map((_, other) => other).filter((other) => names[other] === names[index] && paths[other] !== path);
        if (same.length === 0) {
            return '';
        }
        const rivals = [...new Set(same.map((other) => paths[other]!))].map((other) => folders[paths.indexOf(other)]!);
        const mine = folders[index]!;
        for (let depth = 1; depth <= mine.length; depth++) {
            const tail = mine.slice(-depth).join('/');
            if (rivals.every((rival) => rival.slice(-depth).join('/') !== tail)) {
                return tail;
            }
        }
        return mine.join('/');
    });
}

/* The column a character stands at once tabs are expanded to their stops, which is where a monospace face draws it. */
export function visualColumnOf(line: string, character: number, tabSize: number): number {
    let column = 0;
    for (let i = 0; i < Math.min(character, line.length); i++) {
        column += line[i] === '\t' ? tabSize - (column % tabSize) : 1;
    }
    return column;
}
