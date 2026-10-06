import { clipText, FS_GREP_CONTEXT_LINES, FS_GREP_MAX_RESULTS, type FsGrepMatch, type FsGrepResult } from '@ruimte/contracts';
import { CodedError } from '@adecore/agents/coded-error';
import { listSearchableFiles } from './search.ts';

// A file larger than this is generated, minified or data; searching it costs more than it answers.
const MAX_FILE_BYTES = 2 * 1024 * 1024;
// A hit on a line this long is one nothing can show; the line is a minified bundle, not source.
const MAX_LINE_LENGTH = 500;

// A pattern that backtracks without end holds the event loop one line at a time, not one search.
const JS_SLICE_MS = 50;
// Past this the search without ripgrep answers with what it found so far.
const JS_BUDGET_MS = 10_000;

export interface GrepOptions {
    regex?: boolean;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    limit?: number;
    /* The clock the search without ripgrep keeps its budget by, in milliseconds. */
    now?: () => number;
}

type GrepErrorCode = 'invalid-query';

export class GrepError extends CodedError<GrepErrorCode> {}

function escapeLiteral(query: string): string {
    return query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* The query as a regular expression, whatever the person typed it as. Throws what the client shows
   when the pattern itself is the problem. */
function toRegExp(query: string, options: GrepOptions): RegExp {
    const source = options.regex ? query : escapeLiteral(query);
    const pattern = options.wholeWord ? `\\b(?:${source})\\b` : source;
    try {
        return new RegExp(pattern, options.caseSensitive ? '' : 'i');
    } catch {
        throw new GrepError('invalid-query', 'That is not a valid search pattern');
    }
}

/*
 * The lines a hit is read in. `before` runs nearest last and `after` nearest first, and a line the
 * source does not have (the top or the bottom of the file) is simply absent.
 */
function contextOf(lineOf: (line: number) => string | undefined, line: number): Pick<FsGrepMatch, 'before' | 'after'> {
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

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/* Ripgrep counts in bytes and the viewer draws in UTF-16 units, which are the same thing until a
   line holds something outside ASCII. */
function toUnits(text: string, byteOffset: number): number {
    if (byteOffset === 0) {
        return 0;
    }
    return decoder.decode(encoder.encode(text).slice(0, byteOffset)).length;
}

interface RipgrepLineData {
    path?: { text?: string };
    line_number?: number;
    lines?: { text?: string };
    submatches?: Array<{ start: number; end: number }>;
}

interface Collected {
    line: number;
    text: string;
    start: number;
    end: number;
}

/* One file's hits and the lines around them, turned into the matches the wire carries. */
function matchesOfFile(path: string, hits: Collected[], lines: Map<number, string>): FsGrepMatch[] {
    return hits.map((hit) => {
        const text = clipText(hit.text, MAX_LINE_LENGTH);
        const column = toUnits(hit.text, hit.start);
        return {
            path,
            line: hit.line,
            column: Math.min(column, text.length),
            length: Math.min(toUnits(hit.text, hit.end) - column, Math.max(text.length - column, 0)),
            text,
            ...contextOf((line) => lines.get(line), hit.line)
        };
    });
}

/*
 * Ripgrep's JSON stream, one event per line: `begin` opens a file, `match` and `context` carry a
 * line each, `end` closes it. Both line kinds are kept, because the context of one hit is another
 * hit as often as not. The walk stops at the limit and the process is killed where it stands.
 */
async function searchWithRipgrep(binary: string, cwd: string, query: string, options: GrepOptions, limit: number): Promise<FsGrepResult> {
    const args = [
        binary,
        '--json',
        `--context=${FS_GREP_CONTEXT_LINES}`,
        // Lookaround and backreferences need PCRE2, which `auto` picks only for a pattern that does.
        ...(options.regex ? ['--engine=auto'] : ['--fixed-strings']),
        options.caseSensitive ? '--case-sensitive' : '--ignore-case',
        ...(options.wholeWord ? ['--word-regexp'] : []),
        `--max-filesize=${MAX_FILE_BYTES}`,
        '--no-messages',
        '--',
        query,
        // The directory spelled out, so ripgrep never falls back to reading the query from stdin.
        '.'
    ];
    const proc = Bun.spawn(args, { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
    const matches: FsGrepMatch[] = [];
    const files = new Set<string>();
    let truncated = false;
    let finished = false;
    let path: string | null = null;
    let hits: Collected[] = [];
    let lines = new Map<number, string>();
    let rest = '';

    const flush = (): void => {
        if (path !== null && hits.length > 0) {
            files.add(path);
            for (const match of matchesOfFile(path, hits, lines)) {
                if (matches.length >= limit) {
                    truncated = true;
                    break;
                }
                matches.push(match);
            }
        }
        path = null;
        hits = [];
        lines = new Map();
    };

    const handle = (line: string): void => {
        if (line === '') {
            return;
        }
        let event: { type?: string; data?: RipgrepLineData };
        try {
            event = JSON.parse(line) as { type?: string; data?: RipgrepLineData };
        } catch {
            return;
        }
        const data = event.data ?? {};
        if (event.type === 'begin') {
            flush();
            // Searching `.` prefixes every path with it, and nothing else on the wire carries that.
            path = data.path?.text?.replace(/^\.\//, '') ?? null;
            return;
        }
        if (event.type === 'end') {
            flush();
            return;
        }
        if (event.type === 'summary') {
            finished = true;
            return;
        }
        // A line without text is binary, and a file that holds one has nothing to read anyway.
        const text = data.lines?.text;
        const number = data.line_number;
        if (text === undefined || number === undefined) {
            return;
        }
        const stripped = text.replace(/\r?\n$/, '');
        lines.set(number, stripped);
        const submatch = event.type === 'match' ? data.submatches?.[0] : undefined;
        if (submatch) {
            hits.push({ line: number, text: stripped, start: submatch.start, end: submatch.end });
        }
    };

    for await (const chunk of proc.stdout) {
        rest += decoder.decode(chunk, { stream: true });
        const parts = rest.split('\n');
        rest = parts.pop() ?? '';
        for (const part of parts) {
            handle(part);
        }
        if (matches.length >= limit) {
            truncated = true;
            proc.kill();
            break;
        }
    }
    handle(rest);
    flush();
    await proc.exited;
    // Ripgrep that turned the pattern away searched nothing, which is not the same as finding nothing.
    if (!finished && !truncated) {
        throw new Error(`ripgrep stopped with code ${proc.exitCode} before it searched`);
    }
    return { matches: matches.slice(0, limit), files: files.size, truncated };
}

/* The same search without ripgrep: over the file list `fs.search` already keeps, one file at a
   time. Slower on a large tree, and the only way a machine without the binary searches at all. */
async function searchInJs(cwd: string, query: string, options: GrepOptions, limit: number): Promise<FsGrepResult> {
    const now = options.now ?? (() => performance.now());
    const started = now();
    let sliceStarted = started;
    let outOfTime = false;
    const pattern = toRegExp(query, options);
    const { files: paths, truncated: walkTruncated } = await listSearchableFiles(cwd);
    const matches: FsGrepMatch[] = [];
    const files = new Set<string>();
    let truncated = walkTruncated;
    for (const path of paths) {
        if (matches.length >= limit || outOfTime) {
            truncated = true;
            break;
        }
        const file = Bun.file(`${cwd}/${path}`);
        if (file.size > MAX_FILE_BYTES) {
            continue;
        }
        let content: string;
        try {
            content = await file.text();
        } catch {
            continue;
        }
        // A NUL in the first block is what every other tool calls binary, and it reads as one.
        if (content.slice(0, 1024).includes('\0')) {
            continue;
        }
        const lines = content.split('\n');
        for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
            if (now() - sliceStarted > JS_SLICE_MS) {
                await new Promise((resolve) => setImmediate(resolve));
                if (now() - started > JS_BUDGET_MS) {
                    outOfTime = true;
                    break;
                }
                sliceStarted = now();
            }
            const text = lines[index]!.replace(/\r$/, '');
            const found = pattern.exec(text);
            if (!found) {
                continue;
            }
            files.add(path);
            matches.push({
                path,
                line: index + 1,
                column: Math.min(found.index, MAX_LINE_LENGTH),
                length: Math.min(found[0].length, MAX_LINE_LENGTH - Math.min(found.index, MAX_LINE_LENGTH)),
                text: clipText(text, MAX_LINE_LENGTH),
                ...contextOf((line) => lines[line - 1]?.replace(/\r$/, ''), index + 1)
            });
        }
    }
    return { matches, files: files.size, truncated: truncated || outOfTime };
}

/*
 * Every line under `cwd` that answers to the query, with the lines around it. Ripgrep does the work
 * where it is installed, because nothing in JavaScript comes close on a tree of any size; the
 * fallback searches the same files the fuzzy file search already lists.
 */
export async function grepFiles(cwd: string, query: string, options: GrepOptions = {}): Promise<FsGrepResult> {
    const trimmed = query.trim();
    if (trimmed === '') {
        return { matches: [], files: 0, truncated: false };
    }
    const limit = Math.min(options.limit ?? FS_GREP_MAX_RESULTS, FS_GREP_MAX_RESULTS);
    // The pattern is checked here as well, so a broken regex fails the same way on both paths.
    toRegExp(trimmed, options);
    // The PATH as it is now: Bun's own lookup keeps the one the process started with.
    const binary = Bun.which('rg', { PATH: process.env.PATH ?? '' });
    if (binary === null) {
        return searchInJs(cwd, trimmed, options, limit);
    }
    try {
        return await searchWithRipgrep(binary, cwd, trimmed, options, limit);
    } catch {
        return searchInJs(cwd, trimmed, options, limit);
    }
}
