import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type {
    GitActionPhase,
    GitActionResult,
    GitConflictFile,
    GitConflictKind,
    GitConflictResult,
    GitConflictsResult,
    GitOperation,
    GitResolvePayload
} from '@ruimte/contracts';
import type { ProgressSink } from './actions.ts';
import { parseNumstat } from './diff.ts';
import { git, runGit, runGitBytes, streamGit, toplevel, GitError } from './run.ts';

// A side larger than this is one nobody merges line by line; the file is then a choice between whole sides.
const MAX_SIDE_BYTES = 1024 * 1024;

/* The files git left unmerged in a checkout, one per path. */
export async function conflictedFiles(cwd: string): Promise<string[]> {
    const output = await git(['diff', '--name-only', '--diff-filter=U', '-z'], cwd);
    return output === null ? [] : [...new Set(output.split('\0').filter((path) => path !== ''))];
}

/* Where git keeps a file of its own for this checkout, such as MERGE_HEAD, or null when it has none. */
export async function gitPath(cwd: string, name: string): Promise<string | null> {
    const found = (await git(['rev-parse', '--git-path', name], cwd))?.trim();
    if (found === undefined || found === '') {
        return null;
    }
    const path = isAbsolute(found) ? found : join(cwd, found);
    return await stat(path).then(
        () => path,
        () => null
    );
}

export async function gitPathExists(cwd: string, name: string): Promise<boolean> {
    return (await gitPath(cwd, name)) !== null;
}

async function readGitFile(cwd: string, name: string): Promise<string | null> {
    const path = await gitPath(cwd, name);
    return path === null ? null : await readFile(path, 'utf8').catch(() => null);
}

export async function hasStaged(cwd: string): Promise<boolean> {
    return (await runGit(['diff', '--cached', '--quiet'], cwd)).code === 1;
}

// SQUASH_MSG lingers after a commit; only unfinished index work makes it an operation.
export async function squashWaits(cwd: string): Promise<boolean> {
    return (await gitPathExists(cwd, 'SQUASH_MSG')) && ((await conflictedFiles(cwd)).length > 0 || (await hasStaged(cwd)));
}

/*
 * Which operation stopped halfway in this checkout. A rebase writes a directory rather than a file,
 * and which of the two it writes depends on how it was started, so both are asked for.
 */
export async function operationOf(cwd: string): Promise<GitOperation | null> {
    if (await gitPathExists(cwd, 'MERGE_HEAD')) {
        return 'merge';
    }
    if ((await gitPathExists(cwd, 'rebase-merge')) || (await gitPathExists(cwd, 'rebase-apply'))) {
        return 'rebase';
    }
    if (await gitPathExists(cwd, 'CHERRY_PICK_HEAD')) {
        return 'cherry-pick';
    }
    if (await gitPathExists(cwd, 'REVERT_HEAD')) {
        return 'revert';
    }
    if (await squashWaits(cwd)) {
        return 'merge';
    }
    return null;
}

/* A name a person recognizes for a commit: the ref that points at it, else its short hash. */
async function nameOf(cwd: string, commit: string): Promise<string> {
    const named = (await git(['name-rev', '--name-only', '--exclude=tags/*', commit], cwd))?.trim();
    if (named !== undefined && named !== '' && named !== 'undefined') {
        return named.replace(/^remotes\//, '').replace(/[~^].*$/, '');
    }
    return (await git(['rev-parse', '--short', commit], cwd))?.trim() || commit;
}

function firstLine(text: string | null): string {
    return text?.split('\n')[0]?.trim() ?? '';
}

/*
 * What to call the two sides of this operation. A merge takes what is on the branch against what is
 * coming in, but a rebase replays the person's own commits onto another branch, which puts their
 * work on the side git calls theirs. Saying "ours" and "theirs" without that would have a person
 * pick the wrong half of their own work.
 */
async function sidesOf(cwd: string, operation: GitOperation | null): Promise<{ ours: string; theirs: string }> {
    const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd))?.trim() || 'HEAD';
    if (operation === 'rebase') {
        const onto = firstLine(await readGitFile(cwd, 'rebase-merge/onto'));
        const head = firstLine(await readGitFile(cwd, 'rebase-merge/head-name')).replace(/^refs\/heads\//, '');
        const message = firstLine(await readGitFile(cwd, 'rebase-merge/message'));
        return {
            ours: onto === '' ? branch : await nameOf(cwd, onto),
            theirs: message === '' ? head || branch : message
        };
    }
    if (operation === 'merge') {
        const incoming = firstLine(await readGitFile(cwd, 'MERGE_HEAD'));
        return { ours: branch, theirs: incoming === '' ? 'incoming' : await nameOf(cwd, incoming) };
    }
    if (operation === 'cherry-pick' || operation === 'revert') {
        const commit = firstLine(await readGitFile(cwd, operation === 'revert' ? 'REVERT_HEAD' : 'CHERRY_PICK_HEAD'));
        const subject = commit === '' ? '' : ((await git(['log', '-1', '--format=%s', commit], cwd))?.trim() ?? '');
        return { ours: branch, theirs: subject === '' ? 'incoming' : subject };
    }
    return { ours: branch, theirs: 'incoming' };
}

interface Stage {
    mode: string;
    object: string;
}

/*
 * The index entries git keeps for an unmerged file: stage 1 is where both sides started, 2 is ours
 * and 3 is theirs. A side that deleted the file has no stage at all, which is what tells a delete
 * against a change apart from a change against a change.
 */
async function stagesOf(root: string, path?: string): Promise<Map<string, Map<number, Stage>>> {
    const output = await git(['ls-files', '-u', '-z', ...(path === undefined ? [] : ['--', path])], root);
    const files = new Map<string, Map<number, Stage>>();
    for (const record of (output ?? '').split('\0')) {
        if (record === '') {
            continue;
        }
        const [head, name] = record.split('\t');
        const [mode, object, stage] = (head ?? '').split(' ');
        if (name === undefined || mode === undefined || object === undefined || stage === undefined) {
            continue;
        }
        const entry = files.get(name) ?? new Map<number, Stage>();
        entry.set(Number.parseInt(stage, 10), { mode, object });
        files.set(name, entry);
    }
    return files;
}

function kindOf(stages: Map<number, Stage>, binary: boolean): GitConflictKind {
    if ([...stages.values()].some((stage) => stage.mode === '160000')) {
        return 'submodule';
    }
    if (!stages.has(2)) {
        return 'deleted-by-us';
    }
    if (!stages.has(3)) {
        return 'deleted-by-them';
    }
    return binary ? 'binary' : 'text';
}

/* Everything a checkout waiting halfway holds: what stopped, what the two sides are called, and
   every file left unmerged with the kind of decision it takes. */
export async function readConflicts(cwd: string): Promise<GitConflictsResult> {
    const root = await toplevel(cwd);
    const operation = await operationOf(root);
    const [sides, stages, numstat] = await Promise.all([sidesOf(root, operation), stagesOf(root), git(['diff', '--numstat', '-z', '--diff-filter=U'], root)]);
    const binary = new Set(
        parseNumstat(numstat ?? '')
            .filter((entry) => entry.binary)
            .map((entry) => entry.path)
    );
    const files: GitConflictFile[] = [...stages.entries()]
        .map(([path, entry]) => ({ path, kind: kindOf(entry, binary.has(path)) }))
        .sort((left, right) => left.path.localeCompare(right.path));
    return { operation, ours: sides.ours, theirs: sides.theirs, files };
}

/* Written back as the same bytes: a file in another encoding is not text to merge, and a BOM stays in the text. */
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function decoded(bytes: Uint8Array): string | null {
    try {
        return UTF8.decode(bytes);
    } catch {
        return null;
    }
}

/* One side out of the index, or null when that side has none. Binary and oversized sides read null
   as well: what comes back here is only ever text a person could merge by hand. */
async function sideText(root: string, stage: Stage | undefined): Promise<{ text: string | null; omitted: 'binary' | 'too-large' | null }> {
    if (stage === undefined) {
        return { text: null, omitted: null };
    }
    const size = Number.parseInt((await git(['cat-file', '-s', stage.object], root))?.trim() ?? '', 10);
    if (Number.isFinite(size) && size > MAX_SIDE_BYTES) {
        return { text: null, omitted: 'too-large' };
    }
    const blob = await runGitBytes(['cat-file', 'blob', stage.object], root);
    if (blob.code !== 0) {
        return { text: null, omitted: null };
    }
    const text = decoded(blob.stdout);
    return text === null || text.includes('\0') ? { text: null, omitted: 'binary' } : { text, omitted: null };
}

function digest(bytes: Uint8Array): string {
    return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}

/* The digest of what stands on disk right now, and the empty string for a file that is not there. */
export async function workingDigest(root: string, path: string): Promise<string> {
    const bytes = await readFile(join(root, path)).catch(() => null);
    return bytes === null ? '' : digest(bytes);
}

/* The three versions of one unmerged file, with the digest a resolution is held against. */
export async function readConflict(cwd: string, path: string): Promise<GitConflictResult> {
    const root = await toplevel(cwd);
    const stages = (await stagesOf(root, path)).get(path);
    if (stages === undefined) {
        throw new GitError('git-failed', `${path} is not waiting on a merge.`);
    }
    const [base, ours, theirs] = await Promise.all([sideText(root, stages.get(1)), sideText(root, stages.get(2)), sideText(root, stages.get(3))]);
    const omitted = base.omitted ?? ours.omitted ?? theirs.omitted;
    const kind = kindOf(stages, omitted === 'binary' || omitted === 'too-large');
    return {
        path,
        kind,
        base: base.text,
        ours: ours.text,
        theirs: theirs.text,
        hash: await workingDigest(root, path),
        ...(omitted === null ? {} : { omitted })
    };
}

/*
 * A file settled: the merged text written as it stands, or one side taken whole. A write says what
 * it was written over, and a file that moved since it was read refuses rather than losing whatever
 * moved it; a side taken whole is held to that digest too when the client sends one, which an older
 * iPhone does not. Staging is part of the same step, since git reads an unmerged file as resolved
 * only once it is in the index.
 */
export async function resolveConflict(payload: GitResolvePayload): Promise<number> {
    const root = await toplevel(payload.cwd);
    const { path } = payload;
    if ((await stagesOf(root, path)).get(path) === undefined) {
        throw new GitError('git-failed', `${path} is not waiting on a merge anymore.`);
    }
    if (payload.hash !== undefined && (await workingDigest(root, path)) !== payload.hash) {
        throw new GitError('git-failed', `${path} changed on disk while it was being resolved.`);
    }
    if (payload.take === 'delete') {
        const removed = await runGit(['rm', '--force', '--', path], root);
        if (removed.code !== 0) {
            throw new GitError('git-failed', removed.stderr.trim() || `git rm ${path} failed`);
        }
        return (await conflictedFiles(root)).length;
    }
    if (payload.take !== undefined) {
        const taken = await runGit(['checkout', `--${payload.take}`, '--', path], root);
        if (taken.code !== 0) {
            throw new GitError('git-failed', taken.stderr.trim() || `git checkout --${payload.take} ${path} failed`);
        }
    } else {
        if (payload.content === undefined || payload.hash === undefined) {
            throw new GitError('git-failed', 'A resolution needs the merged file and the digest it was written over.');
        }
        await writeFile(join(root, path), payload.content, 'utf8');
    }
    const staged = await runGit(['add', '--', path], root);
    if (staged.code !== 0) {
        throw new GitError('git-failed', staged.stderr.trim() || `git add ${path} failed`);
    }
    return (await conflictedFiles(root)).length;
}

const CONTINUE: Record<GitOperation, string[]> = {
    merge: ['commit', '--no-edit'],
    rebase: ['rebase', '--continue'],
    'cherry-pick': ['cherry-pick', '--continue'],
    revert: ['revert', '--continue']
};

const ABORT: Record<GitOperation, string[]> = {
    merge: ['merge', '--abort'],
    rebase: ['rebase', '--abort'],
    'cherry-pick': ['cherry-pick', '--abort'],
    revert: ['revert', '--abort']
};

/*
 * How the operation that waits is taken back. `merge --abort` needs the MERGE_HEAD a squash never
 * writes, so a squash goes back with `reset --merge`, which keeps what the person had changed and
 * not added; the message it prepared goes with it, or it would open as the draft of their next commit.
 */
export async function abortOperation(cwd: string): Promise<{ operation: GitOperation; output: string }> {
    const root = await toplevel(cwd);
    const operation = await operationOf(root);
    if (operation === null) {
        throw new GitError('git-failed', 'No merge or rebase waits in this checkout.');
    }
    const squash = operation === 'merge' && !(await gitPathExists(root, 'MERGE_HEAD'));
    const result = await runGit(squash ? ['reset', '--merge'] : ABORT[operation], root);
    if (result.code !== 0) {
        throw new GitError('git-failed', result.stderr.trim() || `git ${squash ? 'reset --merge' : ABORT[operation].join(' ')} failed`);
    }
    if (squash) {
        const message = await gitPath(root, 'SQUASH_MSG');
        if (message !== null) {
            await rm(message, { force: true });
        }
    }
    return { operation, output: `${result.stdout}${result.stderr}`.trim() };
}

const PHASE: Record<GitOperation, GitActionPhase> = {
    merge: 'merge',
    rebase: 'rebase',
    'cherry-pick': 'commit',
    revert: 'commit'
};

/*
 * Finishing the operation that waits, or taking it back. Nothing here opens an editor: a message git
 * would otherwise ask about is the one it already wrote, and a daemon has no terminal to ask in.
 */
export async function runOperation(cwd: string, action: 'continue' | 'abort', actionId: string, sink: ProgressSink): Promise<GitActionResult> {
    const root = await toplevel(cwd);
    const operation = await operationOf(root);
    if (operation === null) {
        throw new GitError('git-failed', 'No merge or rebase waits in this checkout.');
    }
    const phase = PHASE[operation];
    if (action === 'abort') {
        sink(phase, '');
        const aborted = await abortOperation(root);
        const summary = `Took the ${aborted.operation} back.`;
        sink('done', summary);
        return { actionId, summary, output: aborted.output };
    }
    const left = await conflictedFiles(root);
    if (left.length > 0) {
        throw new GitError('merge-conflict', `${left.length} file${left.length === 1 ? '' : 's'} still conflict.`);
    }
    sink(phase, '');
    const result = await streamGit(CONTINUE[operation], root, {
        env: { GIT_EDITOR: 'true' },
        onLine: (line) => sink(phase, line)
    });
    const output = `${result.stdout}${result.stderr}`.trim();
    const conflicts = await conflictedFiles(root);
    if (result.code !== 0 && conflicts.length === 0) {
        sink('failed', output);
        throw new GitError('git-failed', output || `git ${CONTINUE[operation][0]} failed`);
    }
    // A rebase carries on to the next commit, which is free to conflict in its turn.
    const summary = conflicts.length > 0 ? `${conflicts.length} file${conflicts.length === 1 ? '' : 's'} conflict.` : `Finished the ${operation}.`;
    sink('done', summary);
    return { actionId, summary, output, ...(conflicts.length > 0 ? { conflicts } : {}) };
}
