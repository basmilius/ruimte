import { clipText, FS_GREP_CONTEXT_LINES, type FsGrepMatch } from '@ruimte/contracts';
import type { SearchRoot } from './searchable.ts';

// A file larger than this is generated, minified or data; searching it costs more than it answers.
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
// A hit on a line this long is one nothing can show; the line is a minified bundle, not source.
export const MAX_LINE_LENGTH = 500;

export interface GrepWorkerRequest {
    root: SearchRoot;
    paths: string[];
    source: string;
    flags: string;
    limit: number;
}

/* Each file with hits as it is read, then one closing message. */
export type GrepWorkerMessage = { kind: 'file'; matches: FsGrepMatch[] } | { kind: 'done'; truncated: boolean } | { kind: 'failed'; message: string };

/*
 * The lines a hit is read in. `before` runs nearest last and `after` nearest first, and a line the
 * source does not have (the top or the bottom of the file) is simply absent.
 */
export function contextOf(lineOf: (line: number) => string | undefined, line: number): Pick<FsGrepMatch, 'before' | 'after'> {
    const before: string[] = [];
    const after: string[] = [];
    for (let offset = FS_GREP_CONTEXT_LINES; offset >= 1; offset -= 1) {
        const text = lineOf(line - offset);
        if (text !== undefined) {
            before.push(clipText(text, MAX_LINE_LENGTH));
        }
    }
    for (let offset = 1; offset <= FS_GREP_CONTEXT_LINES; offset += 1) {
        const text = lineOf(line + offset);
        if (text !== undefined) {
            after.push(clipText(text, MAX_LINE_LENGTH));
        }
    }
    return { before, after };
}

/* The lines of a file by their number from 1, without a line ending. */
export function lineReader(content: string): (line: number) => string | undefined {
    const lines = content.split('\n');
    return (line) => lines[line - 1]?.replace(/\r$/, '');
}

/* The first hit on each line of one file, at most `limit` of them. */
export function matchLines(path: string, content: string, pattern: RegExp, limit: number): FsGrepMatch[] {
    const lineOf = lineReader(content);
    const matches: FsGrepMatch[] = [];
    for (let line = 1, text = lineOf(line); text !== undefined && matches.length < limit; line += 1, text = lineOf(line)) {
        const found = pattern.exec(text);
        if (!found) {
            continue;
        }
        const column = Math.min(found.index, MAX_LINE_LENGTH);
        matches.push({
            path,
            line,
            column,
            length: Math.min(found[0].length, MAX_LINE_LENGTH - column),
            text: clipText(text, MAX_LINE_LENGTH),
            ...contextOf(lineOf, line)
        });
    }
    return matches;
}
