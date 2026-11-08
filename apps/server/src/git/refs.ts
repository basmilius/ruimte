import type { GitRef, GitRefCommitResult, GitRefsResult, GitStash } from '@ruimte/contracts';
import { nativePath } from './native-path.ts';
import { FIELD, GitError, git, toplevel } from './run.ts';
import { resolveBase } from './status.ts';

// A branch menu nobody scrolls past this; the field on top of it is what finds the rest.
const MAX_REFS = 200;

const REF_FORMAT = `%(refname:short)${FIELD}%(committerdate:unix)${FIELD}%(HEAD)${FIELD}%(objectname)${FIELD}%(refname)`;

/* One entry of `git worktree list --porcelain`. */
export interface Listed {
    path: string;
    /* Null on a detached HEAD. */
    branch: string | null;
    head: string | null;
    locked: boolean;
    prunable: boolean;
}

/* `worktree list --porcelain` writes a paragraph per checkout, opened by `worktree <path>`. */
export function parseWorktreeList(output: string): Listed[] {
    const entries: Listed[] = [];
    let current: Listed | null = null;
    for (const line of output.split('\n')) {
        if (line.startsWith('worktree ')) {
            current = { path: nativePath(line.slice('worktree '.length)), branch: null, head: null, locked: false, prunable: false };
            entries.push(current);
        } else if (current === null) {
            continue;
        } else if (line.startsWith('HEAD ')) {
            current.head = line.slice('HEAD '.length);
        } else if (line.startsWith('branch ')) {
            current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
        } else if (line === 'locked' || line.startsWith('locked ')) {
            current.locked = true;
        } else if (line === 'prunable' || line.startsWith('prunable ')) {
            current.prunable = true;
        }
    }
    return entries;
}

/* The path of the checkout each branch is out in. */
export function parseWorktreeBranches(output: string): Map<string, string> {
    return new Map(parseWorktreeList(output).flatMap((entry) => (entry.branch === null ? [] : [[entry.branch, entry.path] as const])));
}

/* One line per ref: its short name, the date of its tip, `*` for the one HEAD is on and its commit. */
export function parseRefs(output: string, kind: GitRef['kind'], worktrees: Map<string, string>, base: string | null): GitRef[] {
    const refs: GitRef[] = [];
    for (const line of output.split('\n')) {
        if (line === '') {
            continue;
        }
        const [name = '', at = '', head = '', commit = '', fullName = ''] = line.split(FIELD);
        // Git's own pointer at the remote's default branch is a symbolic ref, not a branch to check out. Newer git shortens it to the remote's bare name.
        if (name === '' || name.endsWith('/HEAD') || (kind === 'remote' && fullName.endsWith('/HEAD'))) {
            continue;
        }
        const worktree = worktrees.get(name);
        refs.push({
            name,
            kind,
            ...(fullName === '' ? {} : { fullName }),
            current: head === '*',
            isDefault: name === base,
            ...(worktree ? { worktree } : {}),
            ...(commit === '' ? {} : { commit }),
            at: Number.parseInt(at, 10) || 0
        });
    }
    return refs;
}

/* `stash list` writes the ref and the message it was saved under, one stash per line. */
function parseStashes(output: string): GitStash[] {
    const stashes: GitStash[] = [];
    for (const line of output.split('\n')) {
        if (line === '') {
            continue;
        }
        const [ref = '', ...rest] = line.split(FIELD);
        if (ref !== '') {
            stashes.push({ ref, message: rest.join(FIELD) });
        }
    }
    return stashes;
}

/*
 * Every branch the panel can put the checkout on, newest tip first: the local ones, then the remote
 * ones. A branch another worktree has out carries that path, because git refuses to check it out
 * twice and the menu says so before the checkout does.
 */
export async function listRefs(cwd: string): Promise<GitRefsResult> {
    const top = await toplevel(cwd);
    const [locals, remotes, worktrees, stashes, base] = await Promise.all([
        git(['for-each-ref', '--sort=-committerdate', `--format=${REF_FORMAT}`, 'refs/heads'], top),
        git(['for-each-ref', '--sort=-committerdate', `--format=${REF_FORMAT}`, 'refs/remotes'], top),
        git(['worktree', 'list', '--porcelain'], top),
        git(['stash', 'list', `--format=%gd${FIELD}%gs`], top),
        resolveBase(top)
    ]);
    const branches = parseWorktreeBranches(worktrees ?? '');
    const refs = [...parseRefs(locals ?? '', 'local', branches, base), ...parseRefs(remotes ?? '', 'remote', new Map(), base)];
    return {
        refs: refs.slice(0, MAX_REFS),
        current: refs.find((ref) => ref.current)?.name ?? null,
        stashes: parseStashes(stashes ?? '')
    };
}

/* The commit a ref names and its subject, to show a person where a new branch would start. */
export async function readRefCommit(cwd: string, ref: string): Promise<GitRefCommitResult> {
    const top = await toplevel(cwd);
    const output = await git(['log', '-1', `--format=%H${FIELD}%s`, '--end-of-options', `${ref}^{commit}`], top);
    if (output === null || output.trim() === '') {
        throw new GitError('ref-not-found', `${ref} is not a branch, tag or commit of this repository.`);
    }
    const [commit = '', ...subject] = output.replace(/\n$/, '').split(FIELD);
    return { commit, subject: subject.join(FIELD) };
}
