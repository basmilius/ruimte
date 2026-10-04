import type { Location } from '@ruimte/smart-editor-lsp';

/* One reference in the list: the line it is on, as the file reads there. */
export interface PeekPlace {
    readonly id: string;
    readonly location: Location;
    /* Zero-based. */
    readonly line: number;
    readonly text: string;
}

export interface PeekFile {
    readonly uri: string;
    readonly places: readonly PeekPlace[];
}

/* The most files whose text is read for the list; a name used everywhere shows the rest as places without a line. */
export const PEEK_READ_FILES = 30;

/* The text of one line, without its indentation. */
export function lineTextOf(text: string, line: number): string {
    return (text.split(/\r\n|\r|\n/)[line] ?? '').trim();
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
        const places = [...byFile.get(uri)!]
            .sort((left, right) => left.range.start.line - right.range.start.line || left.range.start.character - right.range.start.character)
            .map((location, index) => ({
                id: `${fileIndex}:${index}`,
                location,
                line: location.range.start.line,
                text: text === null ? '' : lineTextOf(text, location.range.start.line)
            }));
        return { uri, places };
    });
}

/* A few lines of a file around a line, to draw as the preview of a reference. */
export interface PeekSnippet {
    readonly startLine: number;
    readonly text: string;
    /* Zero-based, from the first line of the snippet. */
    readonly active: number;
}

const BEFORE = 5;
const AFTER = 8;

export function snippetOf(text: string, line: number): PeekSnippet {
    const lines = text.split(/\r\n|\r|\n/);
    const startLine = Math.max(0, line - BEFORE);
    const end = Math.min(lines.length, line + AFTER + 1);
    return { startLine, text: lines.slice(startLine, end).join('\n'), active: line - startLine };
}
