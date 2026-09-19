import i18next from 'i18next';
import type { ProjectFileTabView, Worktree, WorktreeRemoveResult, WorktreeWork } from '@ruimte/contracts';
import { isUnderFolder } from '@/state/fs-watch';

/* The branch the commits are counted against, in words; a worktree the register does not know was measured against the base. */
const targetOf = (worktree: Worktree): string => worktree.from?.branch ?? i18next.t('panels:worktree.baseBranch');

/* "3 uncommitted files, 2 new files and 1 commit that main lacks", leaving out what is zero; empty for a clean worktree. */
export const workSentence = (worktree: Worktree, work: WorktreeWork): string => {
    const parts = [
        ...(work.changed > 0 ? [i18next.t('panels:worktree.work.changed', { count: work.changed })] : []),
        ...(work.untracked > 0 ? [i18next.t('panels:worktree.work.untracked', { count: work.untracked })] : []),
        ...(work.ahead > 0 ? [i18next.t('panels:worktree.work.ahead', { count: work.ahead, target: targetOf(worktree) })] : []),
        ...(work.operation !== undefined ? [i18next.t('panels:worktree.work.operation', { operation: work.operation })] : [])
    ];
    if (parts.length <= 1) {
        return parts[0] ?? '';
    }
    return i18next.t('panels:worktree.work.join', { head: parts.slice(0, -1).join(', '), tail: parts[parts.length - 1] });
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
    const title = i18next.t('panels:worktree.remove.title', { branch: worktree.branch });
    const work = worktree.work;
    if (work === undefined || !hasWork(work)) {
        const clean = worktree.missing ? 'panels:worktree.remove.cleanMissing' : 'panels:worktree.remove.clean';
        return {
            title,
            description: i18next.t(clean, { target: targetOf(worktree) }),
            confirmLabel: i18next.t('common:action.remove'),
            force: false
        };
    }
    const holding = worktree.missing ? 'panels:worktree.remove.holdingMissing' : 'panels:worktree.remove.holding';
    return {
        title,
        description: i18next.t(holding, { work: workSentence(worktree, work) }),
        confirmLabel: i18next.t('panels:worktree.remove.anyway'),
        force: true,
        // The counts come from `git status`, which never sees ignored files, and `--force` takes them all the same.
        ...(worktree.missing ? {} : { note: i18next.t('panels:worktree.remove.ignoredNote') })
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
    const title = i18next.t('panels:worktree.removeAll.title', { count: worktrees.length });
    const holding = worktrees.filter((worktree) => hasWork(worktree.work));
    if (holding.length === 0) {
        return {
            title,
            description: i18next.t('panels:worktree.removeAll.clean'),
            confirmLabel: i18next.t('common:action.remove'),
            force: false
        };
    }
    const lines = holding.map((worktree) =>
        i18next.t('panels:worktree.removeAll.line', { branch: worktree.branch, work: workSentence(worktree, worktree.work!) })
    );
    return {
        title,
        description: i18next.t('panels:worktree.removeAll.holding', { lines: lines.join('. ') }),
        confirmLabel: i18next.t('panels:worktree.remove.anyway'),
        force: true,
        note: i18next.t('panels:worktree.removeAll.ignoredNote')
    };
};

/* What the toast adds under its title: that a branch stayed, or how to bring back one that held commits. */
export const removedToast = (branch: string, result: WorktreeRemoveResult): { description: string } | null => {
    if (result.branchDeleted === false) {
        return { description: i18next.t('panels:worktree.removed.branchStays', { branch }) };
    }
    if (result.branchCommit !== undefined) {
        return { description: i18next.t('panels:worktree.removed.branchDeleted', { branch, commit: result.branchCommit.slice(0, 12) }) };
    }
    return null;
};

/* The short counts a row shows: "3 changed", "2 new", "1 commit". */
export const workCounts = (work: WorktreeWork): string[] => [
    ...(work.operation !== undefined ? [i18next.t('panels:worktree.counts.halfway', { operation: work.operation })] : []),
    ...(work.changed > 0 ? [i18next.t('panels:worktree.counts.changed', { count: work.changed })] : []),
    ...(work.untracked > 0 ? [i18next.t('panels:worktree.counts.new', { count: work.untracked })] : []),
    ...(work.ahead > 0 ? [i18next.t('panels:worktree.counts.commits', { count: work.ahead })] : [])
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
    return behind > 0 ? i18next.t('panels:worktree.origin.behind', { branch, count: behind }) : i18next.t('panels:worktree.origin.from', { branch });
};

/* The shared paths a person typed, split on commas and new lines, without empty entries or repeats. */
export const sharePathsOf = (value: string): string[] => [
    ...new Set(
        value
            .split(/[,\n]/)
            .map((path) => path.trim())
            .filter((path) => path !== '')
    )
];

/*
 * The worktrees nodes that are going work in, leaving out every one a node that stays works in too:
 * removing that one would pull the folder out from under it.
 */
export const worktreesLeftBy = <T extends NodeLike>(worktrees: readonly Worktree[], going: readonly T[], staying: readonly T[]): Worktree[] =>
    worktrees.filter((worktree) => !worktree.missing && nodesInWorktree(going, worktree).length > 0 && nodesInWorktree(staying, worktree).length === 0);

/* What the delete question says about one worktree a going node leaves behind. */
export const leftBehindLine = (worktree: Worktree): string =>
    hasWork(worktree.work)
        ? i18next.t('panels:worktree.leftBehind.holding', { branch: worktree.branch, work: workSentence(worktree, worktree.work!) })
        : i18next.t('panels:worktree.leftBehind.clean', { branch: worktree.branch });
