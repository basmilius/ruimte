import type { ChatCheckpointDiff, ChatCheckpointFile, GitDiffResult, GitDiffScope } from '@ruimte/contracts';
import { git, runGit, toplevel } from './run.ts';

// Beyond these a diff stops being something a person reads, and the chat file stops being small.
const MAX_FILES = 100;
const MAX_FILE_LINES = 2000;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024;

const PATCH_ARGS = ['--no-color', '--no-ext-diff'];

export interface Numstat {
    path: string;
    added: number;
    deleted: number;
    binary: boolean;
}

const countedLines = (numstat: string): number => {
    const added = Number.parseInt(numstat, 10);
    return Number.isNaN(added) ? 0 : added;
};

/*
 * `--numstat -z` writes `<added>\t<deleted>\t<path>` per file, NUL terminated; a binary file counts
 * `-`. A rename leaves the path field empty and writes the old and the new path as two records of
 * their own, so the new one is what the entry ends up carrying.
 */
export const parseNumstat = (output: string): Numstat[] => {
    const records = output.split('\0');
    const entries: Numstat[] = [];
    for (let i = 0; i < records.length; i += 1) {
        const record = records[i];
        if (record === undefined || record === '') {
            continue;
        }
        const [added = '', deleted = '', ...rest] = record.split('\t');
        let path = rest.join('\t');
        if (path === '') {
            i += 2;
            path = records[i] ?? '';
        }
        if (path === '') {
            continue;
        }
        entries.push({ path, added: countedLines(added), deleted: countedLines(deleted), binary: added === '-' });
    }
    return entries;
};

// `--name-status -z` alternates a status letter and the path it belongs to.
const kindsByPath = (output: string): Map<string, ChatCheckpointFile['kind']> => {
    const kinds = new Map<string, ChatCheckpointFile['kind']>();
    const fields = output.split('\0').filter((field) => field !== '');
    for (let i = 0; i + 1 < fields.length; i += 2) {
        const letter = fields[i]![0];
        kinds.set(fields[i + 1]!, letter === 'A' ? 'add' : letter === 'D' ? 'delete' : 'update');
    }
    return kinds;
};

/*
 * What changed between two git trees: one unified diff per file, with the counts a card shows and
 * the caps that keep a chat file small. Both the turn's checkpoint diff and the git panel read
 * their file lists through this, so a diff is capped and shaped the same way wherever it shows up.
 */
export const diffTrees = async (top: string, from: string, to: string): Promise<ChatCheckpointDiff | null> => {
    const numstat = await git(['diff', '--numstat', '-z', '--no-renames', from, to], top);
    const status = await git(['diff', '--name-status', '-z', '--no-renames', from, to], top);
    if (numstat === null || status === null) {
        return null;
    }
    const kinds = kindsByPath(status);
    const counts = parseNumstat(numstat);
    const files: ChatCheckpointFile[] = [];
    let budget = MAX_TOTAL_BYTES;
    for (const count of counts.slice(0, MAX_FILES)) {
        const file: ChatCheckpointFile = {
            path: count.path,
            kind: kinds.get(count.path) ?? 'update',
            added: count.added,
            deleted: count.deleted,
            diff: ''
        };
        if (count.binary) {
            file.omitted = 'binary';
        } else if (count.added + count.deleted > MAX_FILE_LINES) {
            file.omitted = 'too-large';
        } else {
            const body = await git(['diff', ...PATCH_ARGS, from, to, '--', `:(literal)${count.path}`], top);
            if (body === null || body.length > MAX_FILE_BYTES || body.length > budget) {
                file.omitted = 'too-large';
            } else {
                file.diff = body;
                budget -= body.length;
            }
        }
        files.push(file);
    }
    return { files, truncated: counts.length > files.length };
};

export interface DiffOptions {
    scope: GitDiffScope;
    /* Worktree scope only: the index against HEAD instead of the working tree against the index. */
    staged: boolean;
    /* Leaves changes that are whitespace alone out of the diff, counts included. */
    ignoreWhitespace: boolean;
}

const isTracked = async (top: string, path: string): Promise<boolean> => {
    const listed = await git(['ls-files', '-z', '--', `:(literal)${path}`], top);
    return listed !== null && listed !== '';
};

/*
 * The arguments a scope diffs with. An untracked file is nowhere in history, so it is read against
 * `/dev/null` with `--no-index`, which is also the only form that leaves git no repository to
 * consult. `base` diffs the merge base against the working tree, so a file the panel lists shows
 * everything this branch did to it, committed or not.
 */
const diffArgs = async (top: string, path: string, options: DiffOptions, mergeBase: string | null): Promise<string[]> => {
    const args = [...PATCH_ARGS, ...(options.ignoreWhitespace ? ['--ignore-all-space'] : [])];
    if (!(await isTracked(top, path))) {
        return ['diff', ...args, '--no-index', '/dev/null', path];
    }
    if (options.scope === 'base') {
        return ['diff', ...args, mergeBase ?? 'HEAD', '--', `:(literal)${path}`];
    }
    return ['diff', ...args, ...(options.staged ? ['--cached'] : []), '--', `:(literal)${path}`];
};

/* The same call with `--numstat` in it, which is where the counts and the binary flag come from. */
const asNumstat = (args: string[]): string[] => ['diff', '--numstat', '-z', ...args.slice(1)];

/*
 * One file's diff for the git panel. `--no-index` answers 1 when the two sides differ, which is the
 * normal outcome and not a failure, so only a code above that means the diff could not be read.
 */
export const diffFile = async (cwd: string, path: string, options: DiffOptions, mergeBase: string | null): Promise<GitDiffResult> => {
    const top = await toplevel(cwd);
    const args = await diffArgs(top, path, options, mergeBase);
    const counts = await runGit(asNumstat(args), top);
    const stat = counts.code > 1 ? null : (parseNumstat(counts.stdout)[0] ?? null);
    const result: GitDiffResult = {
        path,
        diff: '',
        added: stat?.added ?? 0,
        deleted: stat?.deleted ?? 0,
        binary: stat?.binary ?? false
    };
    if (result.binary) {
        result.omitted = 'binary';
        return result;
    }
    if (result.added + result.deleted > MAX_FILE_LINES) {
        result.omitted = 'too-large';
        return result;
    }
    const patch = await runGit(args, top);
    if (patch.code > 1 || patch.stdout.length > MAX_FILE_BYTES) {
        result.omitted = 'too-large';
        return result;
    }
    result.diff = patch.stdout;
    return result;
};
