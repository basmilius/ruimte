import { CodedError } from '@adecore/agents';
import { cancellableTimeout } from '@adecore/utils/async';
import { clipText, FS_GREP_MAX_RESULTS, type FsGrepMatch, type FsGrepResult } from '@ruimte/contracts';
import { COMPILED } from '../version.ts';
import { contextOf, lineReader, MAX_FILE_BYTES, MAX_LINE_LENGTH, type GrepWorkerMessage, type GrepWorkerRequest } from './grep-lines.ts';
import { holdsMachineHome, NO_MACHINE_HOME, type MachineHomePolicy } from './machine-home.ts';
import { listSearchableFiles } from './search.ts';
import { isOpenName, readSearchable, searchRoot, type SearchRoot } from './searchable.ts';

// Past this the search without ripgrep answers with what it found so far.
const JS_BUDGET_MS = 10_000;

// `scripts/compile.ts` bundles the worker as an entry point of its own, which a binary finds by its place under `src`.
const WORKER_URL = COMPILED ? './fs/grep-worker.ts' : new URL('./grep-worker.ts', import.meta.url).href;

// A word character as ripgrep's Unicode `\w` has it, which JavaScript's `\b` only knows for ASCII.
const WORD = '[\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\p{Join_Control}]';

export interface GrepOptions {
    regex?: boolean;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    limit?: number;
    /* Starts the clock of the search without ripgrep: `stop` ends it, and what this returns cancels the clock. */
    budget?: (stop: () => void) => () => void;
    /* The machine's own state, which no name, line or context of a result may come from. */
    policy?: MachineHomePolicy;
}

type GrepErrorCode = 'invalid-query';

export class GrepError extends CodedError<GrepErrorCode> {}

function invalidQuery(): GrepError {
    return new GrepError('invalid-query', 'That is not a valid search pattern');
}

function escapeLiteral(query: string): string {
    return query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* The query as a regular expression, whatever the person typed it as. Throws what the client shows
   when the pattern itself is the problem. */
function toRegExp(query: string, options: GrepOptions): RegExp {
    const source = options.regex ? query : escapeLiteral(query);
    const caseFlag = options.caseSensitive ? '' : 'i';
    if (options.wholeWord) {
        try {
            return new RegExp(`(?<!${WORD})(?:${source})(?!${WORD})`, `u${caseFlag}`);
        } catch {
            // A pattern that only parses without the `u` flag (`\-`, `\8`) keeps the ASCII word edge.
        }
    }
    const pattern = options.wholeWord ? `\\b(?:${source})\\b` : source;
    try {
        return new RegExp(pattern, caseFlag);
    } catch {
        throw invalidQuery();
    }
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

/* One file's hits, turned into the matches the wire carries; `lineOf` reads the file as the daemon itself read it. */
function matchesOfFile(path: string, hits: Collected[], lineOf: (line: number) => string | undefined): FsGrepMatch[] {
    return hits.map((hit) => {
        const text = clipText(hit.text, MAX_LINE_LENGTH);
        const column = toUnits(hit.text, hit.start);
        return {
            path,
            line: hit.line,
            column: Math.min(column, text.length),
            length: Math.min(toUnits(hit.text, hit.end) - column, Math.max(text.length - column, 0)),
            text,
            ...contextOf(lineOf, hit.line)
        };
    });
}

interface CollectedFile {
    path: string;
    hits: Collected[];
}

/*
 * Ripgrep's JSON stream, one event per line: `begin` opens a file, `match` carries a hit, `end`
 * closes it. The walk stops at the limit and the process is killed where it stands. Ripgrep only says
 * where the hits are; the lines that go out are read again by `confirmed`.
 */
async function searchWithRipgrep(
    binary: string,
    cwd: string,
    query: string,
    options: GrepOptions,
    limit: number
): Promise<{ files: CollectedFile[]; truncated: boolean }> {
    const args = [
        binary,
        '--json',
        // Lookaround and backreferences need PCRE2, which `auto` picks only for a pattern that does.
        ...(options.regex ? ['--engine=auto'] : ['--fixed-strings']),
        options.caseSensitive ? '--case-sensitive' : '--ignore-case',
        ...(options.wholeWord ? ['--word-regexp'] : []),
        `--max-filesize=${MAX_FILE_BYTES}`,
        `--max-count=${limit}`,
        '--no-messages',
        '--',
        query,
        // The directory spelled out, so ripgrep never falls back to reading the query from stdin.
        '.'
    ];
    const proc = Bun.spawn(args, { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
    const files: CollectedFile[] = [];
    let found = 0;
    let finished = false;
    let current: CollectedFile | null = null;
    let rest = '';

    const close = (): void => {
        if (current !== null && current.hits.length > 0) {
            files.push(current);
        }
        current = null;
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
            close();
            // Searching `.` prefixes every path with it, and nothing else on the wire carries that.
            const path = data.path?.text?.replace(/^\.\//, '');
            current = path === undefined ? null : { path, hits: [] };
            return;
        }
        if (event.type === 'end') {
            close();
            return;
        }
        if (event.type === 'summary') {
            finished = true;
            return;
        }
        // A line without text is binary, and a file that holds one has nothing to read anyway.
        const text = data.lines?.text;
        const number = data.line_number;
        const submatch = data.submatches?.[0];
        if (event.type !== 'match' || current === null || text === undefined || number === undefined || submatch === undefined || found >= limit) {
            return;
        }
        current.hits.push({ line: number, text: text.replace(/\r?\n$/, ''), start: submatch.start, end: submatch.end });
        found += 1;
    };

    let truncated = false;
    for await (const chunk of proc.stdout) {
        rest += decoder.decode(chunk, { stream: true });
        const parts = rest.split('\n');
        rest = parts.pop() ?? '';
        for (const part of parts) {
            handle(part);
        }
        if (found >= limit) {
            truncated = true;
            rest = '';
            proc.kill();
            break;
        }
    }
    handle(rest);
    close();
    await proc.exited;
    if (!finished && !truncated) {
        // Exit code 2 before any search is ripgrep turning the pattern away; the search without it would only accept what ripgrep refused.
        if (proc.exitCode === 2) {
            throw invalidQuery();
        }
        throw new Error(`ripgrep stopped with code ${proc.exitCode} before it searched`);
    }
    return { files, truncated };
}

/*
 * What ripgrep found, read again by the daemon the way the search without it reads: a file that is
 * not open to the client, or that a link led ripgrep to for a moment, is dropped, and every line that
 * goes out (a hit and its context) is one the daemon read from a file it judged itself.
 */
async function confirmed(root: SearchRoot, files: CollectedFile[]): Promise<FsGrepMatch[]> {
    const matches: FsGrepMatch[] = [];
    for (const file of files) {
        const content = await readSearchable(root, file.path);
        if (content === null) {
            continue;
        }
        const lineOf = lineReader(content);
        const hits = file.hits.filter((hit) => lineOf(hit.line) === hit.text);
        matches.push(...matchesOfFile(file.path, hits, lineOf));
    }
    return matches;
}

function startBudget(stop: () => void): () => void {
    return cancellableTimeout(JS_BUDGET_MS, stop);
}

/* The same search without ripgrep: over the file list `fs.search` already keeps, on a worker that
   is terminated when its time is up. Slower on a large tree, and the only way a machine without the
   binary searches at all. */
async function searchInJs(root: SearchRoot, query: string, options: GrepOptions, limit: number): Promise<FsGrepResult> {
    const pattern = toRegExp(query, options);
    const listed = await listSearchableFiles(root.cwd);
    const walkTruncated = listed.truncated;
    const paths = listed.files.filter((path) => isOpenName(root, path));
    const matches: FsGrepMatch[] = [];
    const worker = new Worker(WORKER_URL);
    return new Promise<FsGrepResult>((resolve, reject) => {
        let settled = false;
        let cancel = (): void => undefined;
        const settle = (outcome: () => void): void => {
            if (settled) {
                return;
            }
            settled = true;
            cancel();
            worker.terminate();
            outcome();
        };
        const answer = (truncated: boolean): void => {
            const result = grepResult(matches.slice(0, limit), truncated || walkTruncated);
            settle(() => resolve(result));
        };
        worker.onmessage = (event: MessageEvent<GrepWorkerMessage>) => {
            const message = event.data;
            if (message.kind === 'file') {
                matches.push(...message.matches);
            } else if (message.kind === 'done') {
                answer(message.truncated);
            } else {
                settle(() => reject(new Error(message.message)));
            }
        };
        worker.onerror = (event) => settle(() => reject(new Error(event.message)));
        worker.postMessage({ root, paths, source: pattern.source, flags: pattern.flags, limit } satisfies GrepWorkerRequest);
        // A pattern that backtracks without end never yields, so only terminating its thread stops it.
        cancel = (options.budget ?? startBudget)(() => answer(true));
    });
}

/*
 * Every line under `cwd` that answers to the query, with the lines around it. Ripgrep does the work
 * where it is installed, because nothing in JavaScript comes close on a tree of any size; the
 * fallback searches the same files the fuzzy file search already lists.
 */
export async function grepFiles(cwd: string, query: string, options: GrepOptions = {}): Promise<FsGrepResult> {
    const trimmed = query.trim();
    if (trimmed === '') {
        return grepResult([], false);
    }
    const limit = Math.min(options.limit ?? FS_GREP_MAX_RESULTS, FS_GREP_MAX_RESULTS);
    // The pattern is checked here as well, so a broken regex fails the same way on both paths.
    toRegExp(trimmed, options);
    const root = await searchRoot(cwd, options.policy ?? NO_MACHINE_HOME);
    // The PATH as it is now: Bun's own lookup keeps the one the process started with.
    const binary = Bun.which('rg', { PATH: process.env.PATH ?? '' });
    // Below a folder that holds the home every name is judged before it is read, which only the search without ripgrep can.
    if (binary === null || holdsMachineHome(root.policy, root.cwd) || holdsMachineHome(root.policy, root.realCwd)) {
        return searchInJs(root, trimmed, options, limit);
    }
    let found: { files: CollectedFile[]; truncated: boolean };
    try {
        found = await searchWithRipgrep(binary, root.cwd, trimmed, options, limit);
    } catch (e) {
        if (e instanceof GrepError) {
            throw e;
        }
        return searchInJs(root, trimmed, options, limit);
    }
    return grepResult(await confirmed(root, found.files), found.truncated);
}

function grepResult(matches: FsGrepMatch[], truncated: boolean): FsGrepResult {
    return { matches, files: new Set(matches.map((match) => match.path)).size, truncated };
}
