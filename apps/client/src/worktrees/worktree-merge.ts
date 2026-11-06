import { messageOf } from '@adecore/ui';
import { ActionRefusal } from '@ruimte/actions';
import type { Worktree, WorktreeMergePayload, WorktreeMergeResult, WorktreeMergeStrategy } from '@ruimte/contracts';
import i18next from 'i18next';

/* The three ways a worktree lands, in the order the dialog offers them. */
export const MERGE_STRATEGIES: readonly WorktreeMergeStrategy[] = ['squash', 'merge', 'rebase'];

/* Asked for when the dialog draws, not held: the language is not in yet at import time. */
export function mergeStrategyLabel(value: WorktreeMergeStrategy): string {
    return i18next.t(`panels:worktree.merge.strategy.${value}.label`);
}

/* The one line under the picker that says what the strategy does. */
export function mergeStrategyLine(value: WorktreeMergeStrategy): string {
    return i18next.t(`panels:worktree.merge.strategy.${value}.line`);
}

function looseFiles(worktree: Worktree): number {
    return (worktree.work?.changed ?? 0) + (worktree.work?.untracked ?? 0);
}

/* "2 commits and 3 uncommitted files", over one worktree or all of a group's; "nothing yet" when there is none. */
export function mergeContents(worktrees: readonly Worktree[]): string {
    const commits = worktrees.reduce((sum, worktree) => sum + (worktree.work?.ahead ?? 0), 0);
    const loose = worktrees.reduce((sum, worktree) => sum + looseFiles(worktree), 0);
    const parts = [
        ...(commits > 0 ? [i18next.t('panels:worktree.merge.commits', { count: commits })] : []),
        ...(loose > 0 ? [i18next.t('panels:worktree.work.changed', { count: loose })] : [])
    ];
    if (parts.length === 0) {
        return i18next.t('panels:worktree.merge.nothing');
    }
    return parts.length === 1 ? parts[0]! : i18next.t('panels:worktree.work.join', { head: parts[0], tail: parts[1] });
}

export function hasLooseWork(worktree: Worktree): boolean {
    return looseFiles(worktree) > 0;
}

/* "lexer into main", or "3 worktrees into main" when they share a target, or "3 worktrees" when they do not. */
export function mergeTitle(worktrees: readonly Worktree[]): string {
    const targets = new Set(worktrees.map((worktree) => worktree.from?.branch ?? null));
    const into = targets.size === 1 ? ([...targets][0] ?? null) : null;
    const what =
        worktrees.length === 1
            ? (worktrees[0]?.branch ?? i18next.t('panels:worktree.merge.one'))
            : i18next.t('panels:worktree.merge.several', { count: worktrees.length });
    return into === null ? i18next.t('panels:worktree.merge.title', { what }) : i18next.t('panels:worktree.merge.titleInto', { what, into });
}

/* The message a commit of the worktree's own work gets: the node that did it, or the branch. It
   stays English in every language, because it is written into the repository and not onto a screen. */
export function defaultSubject(nodeTitle: string | null, branch: string): string {
    return `${nodeTitle?.trim() || branch}: work of the agent`;
}

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
export async function runMerges(
    merge: (run: MergeRun, actionId: string) => Promise<WorktreeMergeResult>,
    runs: readonly MergeRun[],
    actionId: () => string,
    onStart: (run: MergeRun, actionId: string) => void,
    onOutcome: (outcome: MergeOutcome, actionId: string) => void | Promise<void>
): Promise<MergeOutcome[]> {
    const outcomes: MergeOutcome[] = [];
    for (const run of runs) {
        const id = actionId();
        onStart(run, id);
        let outcome: MergeOutcome;
        try {
            const result = await merge(run, id);
            // Conflicts, or none when a hook stopped a merge that ran: either way it waits in the target.
            outcome =
                result.conflicts !== undefined ? { kind: 'conflict', worktree: run.worktree, result } : { kind: 'merged', worktree: run.worktree, result };
        } catch (error: unknown) {
            outcome = {
                kind: 'refused',
                worktree: run.worktree,
                code: error instanceof ActionRefusal ? error.code : 'failed',
                message: messageOf(error, i18next.t('panels:error.generic'))
            };
        }
        outcomes.push(outcome);
        await onOutcome(outcome, id);
        if (outcome.kind !== 'merged') {
            break;
        }
    }
    return outcomes;
}

/*
 * The checkout a worktree's branch is merged into: the project folder when that is on the target, or
 * the worktree that has it out. Null when nothing has it out, which the daemon refuses too.
 */
export function targetCheckout(folder: string, folderBranch: string | null, worktrees: readonly Worktree[], into: string | undefined): string | null {
    if (into === undefined) {
        return null;
    }
    if (folderBranch === into) {
        return folder;
    }
    return worktrees.find((worktree) => worktree.branch === into && !worktree.missing)?.path ?? null;
}

/* What the toast of a merge that went through adds: that the worktree stayed and why, or that it is gone. */
export function mergedDescription(result: WorktreeMergeResult): string | undefined {
    if (result.kept !== undefined) {
        return i18next.t('panels:worktree.merge.kept', { reason: result.kept });
    }
    if (result.removed === true) {
        return result.branchDeleted === false ? i18next.t('panels:worktree.merge.removedKeptBranch') : i18next.t('panels:worktree.merge.removed');
    }
    return undefined;
}
