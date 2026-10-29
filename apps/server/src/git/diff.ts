import { copyFile, lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { missingSides, patchFits } from '@adecore/merge';
import type { ChatCheckpointDiff, ChatCheckpointFile, GitDiffFile, GitDiffResult, GitDiffScope } from '@ruimte/contracts';
import { climbsOut } from '../fs/path-segment.ts';
import { readCommit } from './log.ts';
import { nativePath } from './native-path.ts';
import { collectSinglePatch, collectTreePatches } from './tree-patches.ts';
import { git, runGit, runGitBytes, toplevel, verifyRev, GitError } from './run.ts';

interface DiffCaps {
    files: number;
    fileLines: number;
    fileBytes: number;
    totalBytes: number;
}

// A turn's diff is stored in the chat file, which stays small.
const CHAT_CAPS: DiffCaps = { files: 100, fileLines: 2000, fileBytes: 128 * 1024, totalBytes: 512 * 1024 };

// The git panel reads a diff once and keeps nothing, so only the frame ceiling of a reply bounds it.
const PANEL_CAPS: DiffCaps = { files: 1000, fileLines: 50_000, fileBytes: 2 * 1024 * 1024, totalBytes: 6 * 1024 * 1024 };
// Beyond this a side of one file is not handed over whole, and its diff shows only its hunks.
const MAX_SIDE_BYTES = 512 * 1024;

const PATCH_ARGS = ['--no-color', '--no-ext-diff'];
const TREE_ARGS = ['--no-renames', '--no-ext-diff', '--no-textconv', '--submodule=short'];
// Leave room for the environment and git's other arguments on platforms with small argv limits.
const PATCH_ARG_BYTES = 64 * 1024;

export interface Numstat {
    path: string;
    added: number;
    deleted: number;
    binary: boolean;
}

function countedLines(numstat: string): number {
    const added = Number.parseInt(numstat, 10);
    return Number.isNaN(added) ? 0 : added;
}

/*
 * `--numstat -z` writes `<added>\t<deleted>\t<path>` per file, NUL terminated; a binary file counts
 * `-`. A rename leaves the path field empty and writes the old and the new path as two records of
 * their own, so the new one is what the entry ends up carrying.
 */
export function parseNumstat(output: string): Numstat[] {
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
}

// `--name-status -z` alternates a status letter and the path it belongs to.
function kindsByPath(output: string): Map<string, ChatCheckpointFile['kind']> {
    const kinds = new Map<string, ChatCheckpointFile['kind']>();
    const fields = output.split('\0').filter((field) => field !== '');
    for (let i = 0; i + 1 < fields.length; i += 2) {
        const letter = fields[i]![0];
        kinds.set(fields[i + 1]!, letter === 'A' ? 'add' : letter === 'D' ? 'delete' : 'update');
    }
    return kinds;
}

/*
 * What changed between two git trees: one unified diff per file, with the counts a card shows and
 * the caps of where it shows up. Both the turn's checkpoint diff and the git panel read their file
 * lists through this, so a diff is shaped the same way wherever it shows up.
 */
export async function diffTrees(top: string, from: string, to: string, prefix = '', caps = CHAT_CAPS): Promise<ChatCheckpointDiff | null> {
    // A folder inside the repository narrows the lists to what lies under it; the patches follow the list.
    const under = prefix === '' ? [] : ['--', `:(literal)${prefix}`];
    const [numstat, status] = await Promise.all([
        git(['diff', '--numstat', '-z', ...TREE_ARGS, from, to, ...under], top),
        git(['diff', '--name-status', '-z', ...TREE_ARGS, from, to, ...under], top)
    ]);
    if (numstat === null || status === null) {
        return null;
    }
    const kinds = kindsByPath(status);
    const counts = parseNumstat(numstat);
    const files: ChatCheckpointFile[] = [];
    for (const count of counts.slice(0, caps.files)) {
        const file: ChatCheckpointFile = {
            path: count.path,
            kind: kinds.get(count.path) ?? 'update',
            added: count.added,
            deleted: count.deleted,
            diff: ''
        };

        if (count.binary) {
            file.omitted = 'binary';
        } else if (count.added + count.deleted > caps.fileLines) {
            file.omitted = 'too-large';
        }

        files.push(file);
    }

    let budget = caps.totalBytes;

    for (const batch of patchBatches(files)) {
        const patches = budget > 0 ? await readTreePatches(top, from, to, batch, caps.fileBytes, budget) : null;

        for (let i = 0; i < batch.length; i += 1) {
            const file = batch[i]!;
            let body = patches?.[i];

            // Type changes can emit two headers for one path; a replaced directory can add descendants.
            if (patches === null && batch.length > 1 && budget > 0) {
                body = (await readTreePatches(top, from, to, [file], caps.fileBytes, budget))?.[0];
            }

            if (body === null || body === undefined) {
                file.omitted = 'too-large';
            } else {
                file.diff = body;
                budget -= body.length;
            }
        }
    }

    return { files, truncated: counts.length > files.length };
}

function* patchBatches(files: ChatCheckpointFile[]): Generator<ChatCheckpointFile[]> {
    let batch: ChatCheckpointFile[] = [];
    let bytes = 0;

    for (const file of files) {
        if (file.omitted !== undefined) {
            continue;
        }

        const size = Buffer.byteLength(file.path) + 16;

        if (batch.length > 0 && bytes + size > PATCH_ARG_BYTES) {
            yield batch;
            batch = [];
            bytes = 0;
        }

        batch.push(file);
        bytes += size;
    }

    if (batch.length > 0) {
        yield batch;
    }
}

async function readTreePatches(
    top: string,
    from: string,
    to: string,
    files: ChatCheckpointFile[],
    fileLimit: number,
    totalLimit: number
): Promise<Array<string | null> | null> {
    try {
        const child = Bun.spawn(
            [
                'git',
                'diff',
                ...PATCH_ARGS,
                ...TREE_ARGS,
                // Git config may change these prefixes, including making a content line look like a file header.
                '--line-prefix=',
                '--output-indicator-new=+',
                '--output-indicator-old=-',
                '--output-indicator-context= ',
                from,
                to,
                '--',
                ...files.map((file) => `:(literal)${file.path}`)
            ],
            { cwd: top, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' }
        );
        const collecting =
            files.length === 1
                ? collectSinglePatch(child.stdout, Math.min(fileLimit, totalLimit)).then((patch) => [patch])
                : collectTreePatches(child.stdout, files.length, fileLimit, totalLimit);
        const [patches, code] = await Promise.all([collecting.catch(() => null), child.exited]);

        return code === 0 ? patches : null;
    } catch {
        return null;
    }
}

export interface DiffOptions {
    scope: GitDiffScope;
    /* Commit scope only: which commit the file is read from. */
    commit?: string;
    /* Worktree scope only: the index against HEAD instead of the working tree against the index. */
    staged: boolean;
    /* Leaves changes that are whitespace alone out of the diff, counts included. */
    ignoreWhitespace: boolean;
}

async function isTracked(top: string, path: string): Promise<boolean> {
    const listed = await git(['ls-files', '-z', '--', `:(literal)${path}`], top);
    return listed !== null && listed !== '';
}

/*
 * The arguments a scope diffs with. An untracked file is nowhere in history, so it is read against
 * `/dev/null` with `--no-index`, which is also the only form that leaves git no repository to
 * consult. `base` diffs the merge base against the working tree, so a file the panel lists shows
 * everything this branch did to it, committed or not.
 */
async function diffArgs(top: string, path: string, options: DiffOptions, mergeBase: string | null): Promise<string[]> {
    const args = [...PATCH_ARGS, ...(options.ignoreWhitespace ? ['--ignore-all-space'] : [])];
    // Only the working tree can hold a file git has never seen; in history every path is tracked.
    if (options.scope === 'worktree' && !(await isTracked(top, path))) {
        return ['diff', ...args, '--no-index', '--', '/dev/null', path];
    }
    // A revision comes from a client, so a name like `--output=<file>` must never parse as an option.
    if (options.scope === 'commit') {
        const commit = options.commit ?? 'HEAD';
        return ['diff', ...args, '--end-of-options', `${commit}^`, commit, '--', `:(literal)${path}`];
    }
    if (options.scope === 'base') {
        return ['diff', ...args, mergeBase ?? 'HEAD', '--', `:(literal)${path}`];
    }
    return ['diff', ...args, ...(options.staged ? ['--cached'] : []), '--', `:(literal)${path}`];
}

/* The same call with `--numstat` in it, which is where the counts and the binary flag come from. */
function asNumstat(args: string[]): string[] {
    return ['diff', '--numstat', '-z', ...args.slice(1)];
}

/* Where one side of a file's diff is read from: a blob git names, or a file in the working tree. */
type Side = { blob: string } | { file: string };

/*
 * The two sides a scope compares, for the scopes the panel reads one file in. An untracked file
 * compares against nothing, which its patch says, so the index side it names is never read.
 */
function sidesOf(path: string, options: DiffOptions, mergeBase: string | null): readonly [Side, Side] | null {
    if (options.scope === 'base') {
        return [{ blob: `${mergeBase ?? 'HEAD'}:${path}` }, { file: path }];
    }
    if (options.scope !== 'worktree') {
        return null;
    }
    return options.staged ? [{ blob: `HEAD:${path}` }, { blob: `:0:${path}` }] : [{ blob: `:0:${path}` }, { file: path }];
}

// A patch shows a byte order mark as part of the first line, so a text keeps it too.
const KEEP_BOM = new TextDecoder('utf-8', { ignoreBOM: true });

/* A blob's text, or null when it is missing, too large or not text. */
async function readBlob(top: string, name: string): Promise<string | null> {
    const size = await runGit(['cat-file', '-s', name], top);
    if (size.code !== 0 || Number(size.stdout.trim()) > MAX_SIDE_BYTES) {
        return null;
    }
    const blob = await runGitBytes(['cat-file', 'blob', name], top);
    return blob.code !== 0 || blob.stdout.includes(0) ? null : KEEP_BOM.decode(blob.stdout);
}

/*
 * Whether a path a client named stays inside the checkout, also once every symlinked folder on the
 * way is followed. The file itself may be gone, so the nearest folder of it that exists resolves.
 * A symlink at the end is diffed as its target's name and never read through.
 */
export async function insideCheckout(top: string, path: string): Promise<boolean> {
    const root = await realpath(top);
    if (isAbsolute(path) || climbsOut(relative(root, join(root, path)))) {
        return false;
    }
    let folder = dirname(join(root, path));
    for (;;) {
        try {
            return !climbsOut(relative(root, await realpath(folder)));
        } catch {
            if (folder === root) {
                return false;
            }
            folder = dirname(folder);
        }
    }
}

/*
 * A file of the working tree, or null. A path that leaves the repository, also through a symlinked
 * folder, is never read; a symlink itself is its target's name to git, not a text.
 */
async function readWorktree(top: string, path: string): Promise<string | null> {
    try {
        const root = await realpath(top);
        const file = join(root, path);
        const inside = relative(root, await realpath(file));
        if (inside === '' || climbsOut(inside)) {
            return null;
        }
        const stat = await lstat(file);
        if (!stat.isFile() || stat.size > MAX_SIDE_BYTES) {
            return null;
        }
        const bytes = await readFile(file);
        return bytes.includes(0) ? null : KEEP_BOM.decode(bytes);
    } catch {
        return null;
    }
}

function readSide(top: string, side: Side): Promise<string | null> {
    return 'blob' in side ? readBlob(top, side.blob) : readWorktree(top, side.file);
}

/* A file may change between Git's patch and the snapshot read, so only matching snapshots can be unfolded. */
async function readSides(
    top: string,
    patch: string,
    [oldSide, newSide]: readonly [Side, Side],
    ignoreWhitespace: boolean
): Promise<{ oldText: string; newText: string } | null> {
    const missing = missingSides(patch);
    const oldText = missing.old ? '' : await readSide(top, oldSide);
    const newText = missing.new ? '' : await readSide(top, newSide);
    if (oldText === null || newText === null || !patchFits(patch, oldText, newText, ignoreWhitespace)) {
        return null;
    }
    return { oldText, newText };
}

/*
 * One file's diff for the git panel. `--no-index` answers 1 when the two sides differ, which is the
 * normal outcome and not a failure, so only a code above that means the diff could not be read.
 */
export async function diffFile(cwd: string, path: string, options: DiffOptions, mergeBase: string | null): Promise<GitDiffResult> {
    const top = await toplevel(cwd);
    // An untracked file is read through `--no-index`, which follows any path it is handed.
    if (!(await insideCheckout(top, path))) {
        throw new GitError('outside-checkout', `${path} is not inside the checkout.`);
    }
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
    if (result.added + result.deleted > PANEL_CAPS.fileLines) {
        result.omitted = 'too-large';
        return result;
    }
    const patch = await runGit(args, top);
    if (patch.code > 1 || patch.stdout.length > PANEL_CAPS.fileBytes) {
        result.omitted = 'too-large';
        return result;
    }
    result.diff = patch.stdout;
    const sides = patch.stdout === '' ? null : sidesOf(path, options, mergeBase);
    const texts = sides === null ? null : await readSides(top, patch.stdout, sides, options.ignoreWhitespace);
    if (texts !== null) {
        result.oldText = texts.oldText;
        result.newText = texts.newText;
    }
    return result;
}

// The tree of a repository with nothing in it: what the first commit is diffed against.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/* A commit's parent, or the empty tree for the first commit, which has none to compare with. */
async function parentOf(top: string, commit: string): Promise<string> {
    return (await verifyRev(`${commit}^`, top)) ?? EMPTY_TREE;
}

/*
 * A whole commit as one answer: every file it touched, under the panel's caps, plus
 * the row that names it. The panel's log opens this in a tab of its own, which is why it is one
 * request and not one per file.
 */
export async function diffCommit(cwd: string, commit: string): Promise<GitDiffResult> {
    const top = await toplevel(cwd);
    const hash = await verifyRev(commit, top);
    if (hash === null) {
        throw new GitError('git-failed', `${commit} is not a commit in this repository.`);
    }
    const [diff, meta] = await Promise.all([parentOf(top, hash).then((parent) => diffTrees(top, parent, hash, '', PANEL_CAPS)), readCommit(top, hash)]);
    return { ...filesResult(diff), ...(meta ? { commit: meta } : {}) };
}

/* A tree diff as the answer for many files at once, the counts summed over its files. */
function filesResult(diff: ChatCheckpointDiff | null): GitDiffResult {
    const files: GitDiffFile[] = (diff?.files ?? []).map((file) => ({
        path: file.path,
        kind: file.kind,
        diff: file.diff,
        added: file.added,
        deleted: file.deleted,
        binary: file.omitted === 'binary',
        ...(file.omitted ? { omitted: file.omitted } : {})
    }));
    return {
        path: '',
        diff: '',
        added: files.reduce((total, file) => total + file.added, 0),
        deleted: files.reduce((total, file) => total + file.deleted, 0),
        binary: false,
        files,
        truncated: diff?.truncated ?? false
    };
}

/*
 * Everything a checkout holds over where it left `from`: its commits, its uncommitted changes and
 * its untracked files, as one answer with a file list like a commit's. The working tree becomes a
 * tree through a throwaway index, started from a copy of the checkout's own so git only hashes what
 * changed; the person's index is never written.
 */
export async function diffCheckout(cwd: string, from: string | null): Promise<GitDiffResult> {
    const top = await toplevel(cwd);
    const scratch = await mkdtemp(join(tmpdir(), 'ruimte-diff-'));
    try {
        const index = join(scratch, 'index');
        const own = (await git(['rev-parse', '--git-path', 'index'], top))?.trim();
        if (own) {
            // A checkout without an index yet starts from an empty one, and git then hashes every file.
            await copyFile(isAbsolute(own) ? nativePath(own) : join(top, own), index).catch(() => undefined);
        }
        const env = { GIT_INDEX_FILE: index };
        if ((await git(['add', '-A'], top, env)) === null) {
            throw new GitError('git-failed', `Could not read the working tree of ${top}.`);
        }
        const tree = (await git(['write-tree'], top, env))?.trim();
        if (!tree) {
            throw new GitError('git-failed', `Could not read the working tree of ${top}.`);
        }
        const start = from ?? (await verifyRev('HEAD', top));
        return filesResult(await diffTrees(top, start || EMPTY_TREE, tree, '', PANEL_CAPS));
    } finally {
        await rm(scratch, { recursive: true, force: true });
    }
}
