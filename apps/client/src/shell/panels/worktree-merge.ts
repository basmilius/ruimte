import i18next from 'i18next';
import type { Worktree, WorktreeMergePayload, WorktreeMergeResult, WorktreeMergeStrategy } from '@ruimte/contracts';
import { TransportError } from '@/transport';
import type { Transport } from '@/transport/transport';

/* The three ways a worktree lands, in the order the dialog offers them. */
export const MERGE_STRATEGIES: readonly WorktreeMergeStrategy[] = ['squash', 'merge', 'rebase'];

/* Asked for when the dialog draws, not held: the language is not in yet at import time. */
export const mergeStrategyLabel = (value: WorktreeMergeStrategy): string => i18next.t(`panels:worktree.merge.strategy.${value}.label`);

/* The one line under the picker that says what the strategy does. */
export const mergeStrategyLine = (value: WorktreeMergeStrategy): string => i18next.t(`panels:worktree.merge.strategy.${value}.line`);
/* "2 commits and 3 uncommitted files", over one worktree or all of a group's; "nothing yet" when there is none. */
export const mergeContents = (worktrees: readonly Worktree[]): string => {
    let commits = 0;
    let loose = 0;
    for (const worktree of worktrees) {
        commits += worktree.work?.ahead ?? 0;
        loose += (worktree.work?.changed ?? 0) + (worktree.work?.untracked ?? 0);
    }
    const parts = [
        ...(commits > 0 ? [i18next.t('panels:worktree.merge.commits', { count: commits })] : []),
        ...(loose > 0 ? [i18next.t('panels:worktree.work.changed', { count: loose })] : [])
    ];
    if (parts.length === 0) {
        return i18next.t('panels:worktree.merge.nothing');
    }
    return parts.length === 1 ? parts[0]! : i18next.t('panels:worktree.work.join', { head: parts[0], tail: parts[1] });
};

export const hasLooseWork = (worktree: Worktree): boolean => (worktree.work?.changed ?? 0) + (worktree.work?.untracked ?? 0) > 0;

/* "lexer into main", or "3 worktrees into main" when they share a target, or "3 worktrees" when they do not. */
export const mergeTitle = (worktrees: readonly Worktree[]): string => {
    const targets = new Set(worktrees.map((worktree) => worktree.from?.branch ?? null));
    const into = targets.size === 1 ? [...targets][0] : null;
    const what =
        worktrees.length === 1
            ? (worktrees[0]?.branch ?? i18next.t('panels:worktree.merge.one'))
            : i18next.t('panels:worktree.merge.several', { count: worktrees.length });
    return into === null || into === undefined
        ? i18next.t('panels:worktree.merge.title', { what })
        : i18next.t('panels:worktree.merge.titleInto', { what, into });
};

/* The message a commit of the worktree's own work gets: the node that did it, or the branch. It
   stays English in every language, because it is written into the repository and not onto a screen. */
export const defaultSubject = (nodeTitle: string | null, branch: string): string => `${nodeTitle?.trim() || branch}: work of the agent`;

export type MergeOutcome =
    | { kind: 'merged'; worktree: Worktree; result: WorktreeMergeResult }
    | { kind: 'conflict'; worktree: Worktree; result: WorktreeMergeResult }
    | { kind: 'refused'; worktree: Worktree; code: string; message: string };

export interface MergeRun {
    worktree: Worktree;
    payload: Omit<WorktreeMergePayload, 'actionId'>;
}

/*
 * Merges the worktrees one after the other and stops at the first that conflicts or is refused, so
 * the rest stay as they were. The daemon serializes merges per repository anyway; this is what makes
 * "all" stop where a person has to look.
 */
export const runMerges = async (
    transport: Pick<Transport, 'request'>,
    runs: readonly MergeRun[],
    actionId: () => string,
    onStart: (run: MergeRun, actionId: string) => void,
    onOutcome: (outcome: MergeOutcome, actionId: string) => void
): Promise<MergeOutcome[]> => {
    const outcomes: MergeOutcome[] = [];
    for (const run of runs) {
        const id = actionId();
        onStart(run, id);
        let outcome: MergeOutcome;
        try {
            const result = await transport.request('git.worktree-merge', { ...run.payload, actionId: id });
            // Conflicts, or none when a hook stopped a merge that ran: either way it waits in the target.
            outcome =
                result.conflicts !== undefined ? { kind: 'conflict', worktree: run.worktree, result } : { kind: 'merged', worktree: run.worktree, result };
        } catch (error: unknown) {
            outcome = {
                kind: 'refused',
                worktree: run.worktree,
                code: error instanceof TransportError ? error.code : 'failed',
                message: error instanceof Error ? error.message : i18next.t('panels:error.generic')
            };
        }
        outcomes.push(outcome);
        onOutcome(outcome, id);
        if (outcome.kind !== 'merged') {
            break;
        }
    }
    return outcomes;
};

/* Git refusing a merge over a changed file of the person's, which a stash would move out of the way. */
export const isOverwriteRefusal = (outcome: MergeOutcome): boolean =>
    outcome.kind === 'refused' && outcome.code === 'git-failed' && /would be overwritten by merge|commit your changes or stash them/i.test(outcome.message);

/* The branch a refusal says the project folder is on, when the target branch is checked out nowhere. */
export const checkedOutBranch = (message: string): string | null => {
    const match = / is on ([^\s]+)\.$/.exec(message.trim());
    return match === null || match[1] === 'a' ? null : (match[1] ?? null);
};

/*
 * The checkout a worktree's branch is merged into: the project folder when that is on the target, or
 * the worktree that has it out. Null when nothing has it out, which the daemon refuses too.
 */
export const targetCheckout = (folder: string, folderBranch: string | null, worktrees: readonly Worktree[], into: string | undefined): string | null => {
    if (into === undefined) {
        return null;
    }
    if (folderBranch === into) {
        return folder;
    }
    return worktrees.find((worktree) => worktree.branch === into && !worktree.missing)?.path ?? null;
};

/* What the toast of a merge that went through adds: that the worktree stayed and why, or that it is gone. */
export const mergedDescription = (result: WorktreeMergeResult): string | undefined => {
    if (result.kept !== undefined) {
        return i18next.t('panels:worktree.merge.kept', { reason: result.kept });
    }
    if (result.removed === true) {
        return result.branchDeleted === false ? i18next.t('panels:worktree.merge.removedKeptBranch') : i18next.t('panels:worktree.merge.removed');
    }
    return undefined;
};
