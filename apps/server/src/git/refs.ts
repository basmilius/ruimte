import type { GitRef, GitRefsResult } from '@ruimte/contracts';
import { git, toplevel } from './run.ts';
import { resolveBase } from './status.ts';

// A branch menu nobody scrolls past this; the field on top of it is what finds the rest.
const MAX_REFS = 200;

// A branch name may hold anything but a control character, so this one cannot appear inside a field.
const FIELD = '\u001f';

export const REF_FORMAT = `%(refname:short)${FIELD}%(committerdate:unix)${FIELD}%(HEAD)`;

/* `worktree list --porcelain` writes a paragraph per checkout: `worktree <path>` and `branch <ref>`. */
export const parseWorktreeBranches = (output: string): Map<string, string> => {
    const branches = new Map<string, string>();
    let path: string | null = null;
    for (const line of output.split('\n')) {
        if (line.startsWith('worktree ')) {
            path = line.slice('worktree '.length);
        } else if (line.startsWith('branch refs/heads/') && path !== null) {
            branches.set(line.slice('branch refs/heads/'.length), path);
        }
    }
    return branches;
};

/* One line per ref: its short name, the date of its tip and `*` for the one HEAD is on. */
export const parseRefs = (output: string, kind: GitRef['kind'], worktrees: Map<string, string>, base: string | null): GitRef[] => {
    const refs: GitRef[] = [];
    for (const line of output.split('\n')) {
        if (line === '') {
            continue;
        }
        const [name = '', at = '', head = ''] = line.split(FIELD);
        // Git's own pointer at the remote's default branch is a symbolic ref, not a branch to check out.
        if (name === '' || name.endsWith('/HEAD')) {
            continue;
        }
        const worktree = worktrees.get(name);
        refs.push({
            name,
            kind,
            current: head === '*',
            isDefault: name === base,
            ...(worktree ? { worktree } : {}),
            at: Number.parseInt(at, 10) || 0
        });
    }
    return refs;
};

/*
 * Every branch the panel can put the checkout on, newest tip first: the local ones, then the remote
 * ones. A branch another worktree has out carries that path, because git refuses to check it out
 * twice and the menu says so before the checkout does.
 */
export const listRefs = async (cwd: string): Promise<GitRefsResult> => {
    const top = await toplevel(cwd);
    const [locals, remotes, worktrees, base] = await Promise.all([
        git(['for-each-ref', '--sort=-committerdate', `--format=${REF_FORMAT}`, 'refs/heads'], top),
        git(['for-each-ref', '--sort=-committerdate', `--format=${REF_FORMAT}`, 'refs/remotes'], top),
        git(['worktree', 'list', '--porcelain'], top),
        resolveBase(top)
    ]);
    const branches = parseWorktreeBranches(worktrees ?? '');
    const refs = [...parseRefs(locals ?? '', 'local', branches, base), ...parseRefs(remotes ?? '', 'remote', new Map(), base)];
    return { refs: refs.slice(0, MAX_REFS), current: refs.find((ref) => ref.current)?.name ?? null };
};
