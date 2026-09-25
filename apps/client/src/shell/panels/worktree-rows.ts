import i18next from 'i18next';
import type { ProjectFileTabView, Worktree, WorktreeRemoveResult, WorktreeWork } from '@ruimte/contracts';
import { formatNumber } from '@/format/number';
import { isUnderFolder } from '@/state/fs-watch';

/* The branch the commits are counted against, in words; a worktree the register does not know was measured against the base. */
const targetOf = (worktree: Worktree): string => worktree.from?.branch ?? i18next.t('panels:worktree.baseBranch');

/* Clauses into one sentence, with "and" before the last one. */
const joinClauses = (parts: readonly string[]): string => {
    if (parts.length <= 1) {
        return parts[0] ?? '';
    }
    return i18next.t('panels:worktree.work.join', { head: parts.slice(0, -1).join(', '), tail: parts[parts.length - 1] });
};

/* The clauses for what a worktree holds. Being behind is not one of them: nothing is lost by removing it. */
const heldClauses = (worktree: Worktree, work: WorktreeWork): string[] => [
    ...(work.changed > 0 ? [i18next.t('panels:worktree.work.changed', { count: work.changed })] : []),
    ...(work.untracked > 0 ? [i18next.t('panels:worktree.work.untracked', { count: work.untracked })] : []),
    ...(work.ahead > 0 ? [i18next.t('panels:worktree.work.ahead', { count: work.ahead, target: targetOf(worktree) })] : []),
    ...(work.operation !== undefined ? [i18next.t('panels:worktree.work.operation', { operation: work.operation })] : [])
];

/* "3 uncommitted files, 2 new files and 1 commit that main lacks", leaving out what is zero; empty for a clean worktree. */
export const workSentence = (worktree: Worktree, work: WorktreeWork): string => joinClauses(heldClauses(worktree, work));

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
export const removedToast = (
    branch: string,
    result: { [Field in keyof WorktreeRemoveResult]?: WorktreeRemoveResult[Field] | null }
): { description: string } | null => {
    if (result.branchDeleted === false) {
        return { description: i18next.t('panels:worktree.removed.branchStays', { branch }) };
    }
    if (result.branchCommit != null) {
        return { description: i18next.t('panels:worktree.removed.branchDeleted', { branch, commit: result.branchCommit.slice(0, 12) }) };
    }
    return null;
};

/* What a badge on a row counts; the row draws its own mark per kind. */
export type WorkBadgeKind = 'operation' | 'changed' | 'untracked' | 'ahead' | 'behind';

export interface WorkBadge {
    kind: WorkBadgeKind;
    /* What stands beside the mark: the count, or git's own word for an operation that stopped halfway. */
    text: string;
}

/*
 * The numbers a row shows, leaving out what is zero. They are marks and figures rather than words,
 * so the branch and the node keep the room they need to tell two worktrees apart; `workBadgesLabel`
 * is the sentence behind them.
 */
export const workBadges = (work: WorktreeWork): WorkBadge[] => {
    const behind = work.behind ?? 0;
    return [
        ...(work.operation !== undefined ? [{ kind: 'operation' as const, text: work.operation }] : []),
        ...(work.changed > 0 ? [{ kind: 'changed' as const, text: formatNumber(work.changed) }] : []),
        ...(work.untracked > 0 ? [{ kind: 'untracked' as const, text: formatNumber(work.untracked) }] : []),
        ...(work.ahead > 0 ? [{ kind: 'ahead' as const, text: formatNumber(work.ahead) }] : []),
        ...(behind > 0 ? [{ kind: 'behind' as const, text: formatNumber(behind) }] : [])
    ];
};

/* What the marks say in words, for the tooltip and the accessible name of the badges together. */
export const workBadgesLabel = (worktree: Worktree, work: WorktreeWork): string => {
    const behind = work.behind ?? 0;
    const lagging = behind > 0 ? [i18next.t('panels:worktree.work.behind', { count: behind, target: targetOf(worktree) })] : [];
    return joinClauses([...heldClauses(worktree, work), ...lagging]);
};

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

/* "from main": where a worktree came from. How far that branch moved on since is a badge of its own. */
export const originLabel = (worktree: Worktree): string | null => {
    const branch = worktree.from?.branch;
    return branch === undefined ? null : i18next.t('panels:worktree.origin.from', { branch });
};

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
