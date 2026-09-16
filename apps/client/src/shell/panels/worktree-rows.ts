import type { ProjectFileTabView, Worktree, WorktreeRemoveResult, WorktreeWork } from '@ruimte/contracts';
import { isUnderFolder } from '@/state/fs-watch';

const count = (value: number, one: string, many: string): string => `${value} ${value === 1 ? one : many}`;

/* The branch the commits are counted against, in words; a worktree the register does not know was measured against the base. */
const targetOf = (worktree: Worktree): string => worktree.from?.branch ?? 'the base branch';

/* "3 uncommitted files, 2 new files and 1 commit that main lacks", leaving out what is zero; empty for a clean worktree. */
export const workSentence = (worktree: Worktree, work: WorktreeWork): string => {
    const parts = [
        ...(work.changed > 0 ? [count(work.changed, 'uncommitted file', 'uncommitted files')] : []),
        ...(work.untracked > 0 ? [count(work.untracked, 'new file', 'new files')] : []),
        ...(work.ahead > 0 ? [`${count(work.ahead, 'commit', 'commits')} that ${targetOf(worktree)} lacks`] : []),
        ...(work.operation !== undefined ? [`a ${work.operation} that stopped halfway`] : [])
    ];
    if (parts.length <= 1) {
        return parts[0] ?? '';
    }
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
};

export const hasWork = (work: WorktreeWork | undefined): boolean =>
    work !== undefined && (work.changed + work.untracked + work.ahead > 0 || work.operation !== undefined);

export interface RemoveQuestion {
    title: string;
    description: string;
    confirmLabel: string;
    /* Whether the answer has to go out with `force`, which is only when something would be lost. */
    force: boolean;
    /* A line under the description, for what the counts leave out. */
    note?: string;
}

/*
 * What removing a worktree asks. Without work it is a plain confirm; with work the numbers are the
 * question, since they are exactly what goes, and the branch goes with them.
 */
export const removeQuestion = (worktree: Worktree): RemoveQuestion => {
    const title = `Remove worktree ${worktree.branch}?`;
    const work = worktree.work;
    if (work === undefined || !hasWork(work)) {
        const folder = worktree.missing ? 'Its folder is already gone. ' : '';
        return {
            title,
            description: `${folder}Nothing in it is lost: it holds no uncommitted files, no new files and no commits that ${targetOf(worktree)} lacks.`,
            confirmLabel: 'Remove',
            force: false
        };
    }
    const lost = worktree.missing ? 'Those commits are lost with the branch.' : 'They are lost, and so is the branch.';
    const holds = worktree.missing ? 'Its folder is already gone, and the branch holds' : 'It holds';
    return {
        title,
        description: `${holds} ${workSentence(worktree, work)}. ${lost}`,
        confirmLabel: 'Remove anyway',
        force: true,
        // The counts come from `git status`, which never sees ignored files, and `--force` takes them all the same.
        ...(worktree.missing ? {} : { note: 'Files git ignores in it, such as .env or a local database, go too and are not counted above.' })
    };
};

/*
 * What removing several worktrees at once asks: a plain confirm when none holds work, otherwise each
 * one with work named with its numbers, since that is what goes.
 */
export const removeAllQuestion = (worktrees: readonly Worktree[]): RemoveQuestion => {
    if (worktrees.length === 1 && worktrees[0] !== undefined) {
        return removeQuestion(worktrees[0]);
    }
    const title = `Remove ${worktrees.length} worktrees?`;
    const holding = worktrees.filter((worktree) => hasWork(worktree.work));
    if (holding.length === 0) {
        return {
            title,
            description: 'Nothing in them is lost: none holds uncommitted files, new files or commits its branch lacks.',
            confirmLabel: 'Remove',
            force: false
        };
    }
    const lines = holding.map((worktree) => `${worktree.branch} holds ${workSentence(worktree, worktree.work!)}`);
    return {
        title,
        description: `${lines.join('. ')}. That is lost, and so are their branches.`,
        confirmLabel: 'Remove anyway',
        force: true,
        note: 'Files git ignores in them, such as .env or a local database, go too and are not counted above.'
    };
};

/* What the toast adds under its title: that a branch stayed, or how to bring back one that held commits. */
export const removedToast = (branch: string, result: WorktreeRemoveResult): { description: string } | null => {
    if (result.branchDeleted === false) {
        return { description: `The branch ${branch} stays.` };
    }
    if (result.branchCommit !== undefined) {
        return { description: `Deleted the branch too. "git branch ${branch} ${result.branchCommit.slice(0, 12)}" brings it back.` };
    }
    return null;
};

/* The short counts a row shows: "3 changed", "2 new", "1 commit". */
export const workCounts = (work: WorktreeWork): string[] => [
    ...(work.operation !== undefined ? [`${work.operation} halfway`] : []),
    ...(work.changed > 0 ? [`${work.changed} changed`] : []),
    ...(work.untracked > 0 ? [`${work.untracked} new`] : []),
    ...(work.ahead > 0 ? [count(work.ahead, 'commit', 'commits')] : [])
];

/* The worktree a folder sits in, if any: the node's own cwd is the worktree or somewhere under it. */
export const worktreeOfPath = (worktrees: readonly Worktree[], path: string | undefined | null): Worktree | null => {
    if (!path) {
        return null;
    }
    const trimmed = path.replace(/[/\\]+$/, '');
    return worktrees.find((worktree) => !worktree.missing && (trimmed === worktree.path || isUnderFolder(trimmed, worktree.path))) ?? null;
};

interface NodeLike {
    id: string;
    kind: string;
    title: string;
    cwd?: string;
}

/*
 * The nodes working in a worktree: the one it was made for while it is still in the project, and
 * every terminal or chat whose folder is inside it, since a second agent can be pointed there too.
 */
export const nodesInWorktree = <T extends NodeLike>(nodes: readonly T[], worktree: Worktree): T[] =>
    nodes.filter(
        (node) =>
            node.id === worktree.nodeId ||
            ((node.kind === 'terminal' || node.kind === 'chat') && !worktree.missing && worktreeOfPath([worktree], node.cwd) !== null)
    );

/* What a worktree's diffs measure from: the branch it was made from, or the commit when that was a detached HEAD. */
export const worktreeBase = (worktree: Worktree): string | undefined => worktree.from?.branch ?? worktree.from?.commit;

/* The tab that shows everything a worktree holds over where it was made from, committed or not. */
export const worktreeDiffTab = (worktree: Worktree): { path: string; view: ProjectFileTabView } => {
    const base = worktreeBase(worktree);
    return { path: worktree.path, view: { kind: 'diff', cwd: worktree.path, scope: 'base', staged: false, ...(base === undefined ? {} : { base }) } };
};

/* "from main, 4 commits behind": where a worktree came from, and how far that branch moved on since. */
export const originLabel = (worktree: Worktree): string | null => {
    const branch = worktree.from?.branch;
    if (branch === undefined) {
        return null;
    }
    const behind = worktree.work?.behind ?? 0;
    return behind > 0 ? `from ${branch}, ${count(behind, 'commit', 'commits')} behind` : `from ${branch}`;
};
