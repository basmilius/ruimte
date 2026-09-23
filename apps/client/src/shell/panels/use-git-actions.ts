import { useCallback, useEffect, useMemo, useRef } from 'react';
import i18next from 'i18next';
import { ActionRefusal, type ActionOutput } from '@ruimte/actions';
import type { GitActionKind, GitActionPayload, GitActionResult } from '@ruimte/contracts';
import { cancelGitRunAction, performAsPerson } from '@/actions/client-actions';
import { actionTitle, manySummary, manyTitle, nextActionId, phaseLabel } from '@/shell/panels/git-actions';
import { useToasts, type ToastAction } from '@/state/toasts';
import { useTransport } from '@/transport/context';

type GitRun = ActionOutput<'git.publishBranch'>;

const resultOf = (actionId: string, run: GitRun): GitActionResult => ({
    actionId,
    summary: run.summary,
    output: run.output,
    ...(run.commit === null ? {} : { commit: run.commit }),
    ...(run.url === null ? {} : { url: run.url }),
    ...(run.conflicts.length === 0 ? {} : { conflicts: run.conflicts })
});

/* A run of one repository answers the first entry; the panel never names more than one at a time. */
const firstOf = (actionId: string, output: ActionOutput<'git.push'>): GitActionResult => resultOf(actionId, output.runs[0]!);

/*
 * One of the panel's actions, by the kind the daemon knows it under, run through the catalog as a
 * person's. The panel's own dialogs have asked whatever there was to ask.
 */
export const runGitKind = async ({
    cwd: repository,
    actionId: run,
    kind,
    ref,
    name,
    subject,
    body,
    stageAll,
    stash,
    force,
    strategy
}: GitActionPayload): Promise<GitActionResult> => {
    switch (kind) {
        case 'fetch':
            return firstOf(run, await performAsPerson('git.fetch', { repository, run }));
        case 'pull':
            return firstOf(run, await performAsPerson('git.pull', { repository, strategy: strategy ?? null, run }));
        case 'sync':
            return firstOf(run, await performAsPerson('git.sync', { repository, strategy: strategy ?? null, run }));
        case 'push':
            return firstOf(run, await performAsPerson('git.push', { repository, run }));
        case 'commit':
        case 'commit-push':
            return firstOf(
                run,
                await performAsPerson('git.commit', {
                    repository,
                    message: subject ?? '',
                    body: body ?? null,
                    push: kind === 'commit-push',
                    stageAll: stageAll ?? false,
                    run
                })
            );
        case 'publish':
            return resultOf(run, await performAsPerson('git.publishBranch', { repository, run }));
        case 'force-push':
            return resultOf(run, await performAsPerson('git.forcePush', { repository, run }));
        case 'checkout':
            return resultOf(run, await performAsPerson('git.checkout', { repository, branch: ref ?? '', stashFirst: stash ?? false, run }));
        case 'create-branch':
            return resultOf(run, await performAsPerson('git.createBranch', { repository, name: name ?? '', run }));
        case 'rename-branch':
            return resultOf(run, await performAsPerson('git.renameBranch', { repository, name: name ?? '', run }));
        case 'delete-branch':
            return resultOf(run, await performAsPerson('git.deleteBranch', { repository, branch: ref ?? '', force: force ?? false, run }));
        case 'merge':
            return resultOf(run, await performAsPerson('git.merge', { repository, branch: ref ?? '', run }));
        case 'rebase':
            return resultOf(run, await performAsPerson('git.rebase', { repository, onto: ref ?? '', run }));
        case 'stash':
            return resultOf(run, await performAsPerson('git.stash', { repository, message: subject?.trim() || null, run }));
        case 'stash-pop':
            return resultOf(run, await performAsPerson('git.popStash', { repository, stash: ref ?? '', run }));
        case 'create-pr':
            return resultOf(run, await performAsPerson('git.createPullRequest', { repository, title: subject ?? '', body: body ?? null, run }));
    }
};

export type ActionOutcome = { ok: true; result: GitActionResult } | { ok: false; message: string; code: string | null };

/* One repository's turn in a run over several of them. */
export interface ManyJob {
    cwd: string;
    kind: GitActionKind;
    /* What the toast calls this repository while its turn runs. */
    label: string;
    /* Everything else the action takes, such as the message of a commit. */
    extra?: Partial<Omit<GitActionPayload, 'cwd' | 'kind' | 'actionId'>>;
}

export interface RunOptions {
    /* A button on the toast that says it went well: what the action leads to next. */
    done?(result: GitActionResult): ToastAction | undefined;
}

export interface GitActions {
    /*
     * One toast per run: it goes up the moment the request leaves, follows the phases the daemon
     * streams back, and ends as the summary or as the failure with the output of the command behind a
     * copy button. The caller gets the outcome, because some of them have a second question to ask
     * (deleting a branch git has not merged, for one).
     */
    run(payload: Omit<GitActionPayload, 'actionId'>, options?: RunOptions): Promise<ActionOutcome>;
    /* Every job in order under one toast, which is what pushing a folder of repositories is. */
    runMany(jobs: readonly ManyJob[]): Promise<{ done: number; failed: number }>;
}

/* Running the panel's actions and saying how they went. */
export const useGitActions = (): GitActions => {
    /* Which toast a running action writes to, and the title it has to keep; an action that is over
       is not in here. A run over several repositories owns its title, since that is where the one
       thing a person cannot see from a phase is written: which repository is up and how many are left. */
    const toastByAction = useRef(new Map<string, { toastId: string; title: string | null }>());
    const transport = useTransport();

    useEffect(() => {
        return transport.on('git.progress', (payload) => {
            const entry = toastByAction.current.get(payload.actionId);
            if (entry === undefined || payload.phase === 'done' || payload.phase === 'failed') {
                return;
            }
            useToasts
                .getState()
                .update(entry.toastId, { title: entry.title ?? phaseLabel(payload.phase), ...(payload.line === '' ? {} : { description: payload.line }) });
        });
    }, [transport]);

    const run = useCallback(async (payload: Omit<GitActionPayload, 'actionId'>, options: RunOptions = {}): Promise<ActionOutcome> => {
        const actionId = nextActionId();
        const toasts = useToasts.getState();
        const toastId = toasts.show({
            title: actionTitle(payload.kind),
            kind: 'progress',
            action: {
                label: i18next.t('common:action.cancel'),
                run: () => cancelGitRunAction(actionId)
            }
        });
        toastByAction.current.set(actionId, { toastId, title: null });
        try {
            const result = await runGitKind({ ...payload, actionId });
            const action = options.done?.(result);
            useToasts.getState().show({
                id: toastId,
                title: result.summary,
                kind: 'success',
                ...(action ? { action } : {})
            });
            return { ok: true, result };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : i18next.t('panels:error.generic');
            const code = error instanceof ActionRefusal ? error.code : null;
            // A branch that moved on both sides is a question the panel asks, not a failure to read.
            if (code === 'diverged') {
                useToasts.getState().dismiss(toastId);
            } else {
                useToasts.getState().show({
                    id: toastId,
                    title: i18next.t('panels:git.actionFailed', { action: actionTitle(payload.kind) }),
                    description: message.split('\n')[0],
                    kind: 'error',
                    output: message
                });
            }
            return { ok: false, message, code };
        } finally {
            toastByAction.current.delete(actionId);
        }
    }, []);

    /*
     * One repository after another, never two at once: a folder of nine pushes over one link, and
     * nine toasts would say less than one that counts. A commit over several of them is the same run
     * with the same message. A repository that fails does not stop it, so the summary at the end is
     * where the whole outcome is read; cancel breaks off the turn that is running and leaves the rest
     * alone.
     */
    const runMany = useCallback(async (jobs: readonly ManyJob[]): Promise<{ done: number; failed: number }> => {
        if (jobs.length === 0) {
            return { done: 0, failed: 0 };
        }
        let stopped = false;
        let running: string | null = null;
        const toastId = useToasts.getState().show({
            title: manyTitle(jobs[0]!.kind, jobs[0]!.label, 0, jobs.length),
            kind: 'progress',
            action: {
                label: i18next.t('common:action.cancel'),
                run: () => {
                    stopped = true;
                    if (running !== null) {
                        cancelGitRunAction(running);
                    }
                }
            }
        });
        const failed: string[] = [];
        const outputs: string[] = [];
        let done = 0;
        for (const [index, job] of jobs.entries()) {
            if (stopped) {
                break;
            }
            const actionId = nextActionId();
            const title = manyTitle(job.kind, job.label, index, jobs.length);
            running = actionId;
            toastByAction.current.set(actionId, { toastId, title });
            useToasts.getState().update(toastId, { title, description: undefined });
            try {
                await runGitKind({ cwd: job.cwd, kind: job.kind, actionId, ...job.extra });
                done += 1;
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : i18next.t('panels:error.generic');
                failed.push(job.label);
                outputs.push(`${job.label}: ${message}`);
            } finally {
                running = null;
                toastByAction.current.delete(actionId);
            }
        }
        useToasts.getState().show({
            id: toastId,
            title: manySummary(done, failed),
            kind: failed.length === 0 ? 'success' : 'error',
            ...(outputs.length === 0 ? {} : { description: outputs[0]!.split('\n')[0], output: outputs.join('\n\n') })
        });
        return { done, failed: failed.length };
    }, []);

    return useMemo(() => ({ run, runMany }), [run, runMany]);
};
