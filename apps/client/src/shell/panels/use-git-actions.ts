import { useCallback, useEffect, useMemo, useRef } from 'react';
import i18next from 'i18next';
import { ActionRefusal, type ActionOutput } from '@ruimte/actions';
import type { GitActionKind, GitActionPayload, GitActionResult } from '@ruimte/contracts';
import type { ToastAction } from '@adecore/ui';
import { cancelGitRunAction, performAsPerson } from '@/actions/client-actions';
import { actionTitle, manySummary, manyTitle, nextActionId, phaseLabel } from '@/shell/panels/git-actions';
import { useToasts } from '@/state/toasts';
import { useTransport } from '@/transport/context';

type GitRun = ActionOutput<'git.publishBranch'>;

function resultOf(actionId: string, run: GitRun): GitActionResult {
    return {
        actionId,
        summary: run.summary,
        output: run.output,
        ...(run.commit === null ? {} : { commit: run.commit }),
        ...(run.url === null ? {} : { url: run.url }),
        ...(run.conflicts.length === 0 ? {} : { conflicts: run.conflicts })
    };
}

/* A run of one repository answers the first entry; the panel never names more than one at a time. */
function firstOf(actionId: string, output: ActionOutput<'git.push'>): GitActionResult {
    return resultOf(actionId, output.runs[0]!);
}

/*
 * One of the panel's actions, by the kind the daemon knows it under, run through the catalog as a
 * person's. The panel's own dialogs have asked whatever there was to ask.
 */
export async function runGitKind({
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
}: GitActionPayload): Promise<GitActionResult> {
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
}

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

/* How a run over several repositories ended. A branch that moved on both sides is a question and not a failure. */
export interface ManyOutcome {
    done: number;
    failed: number;
    diverged: ManyJob[];
}

export interface ManyOptions {
    /* Asks how the branch of one repository that moved on both sides comes together, from the summary. */
    choose?(job: ManyJob): void;
}

export interface GitActions {
    /*
     * One toast per run, following the phases the daemon streams back and ending as the summary or the
     * failure. The caller gets the outcome, since some have a second question (an unmerged branch).
     */
    run(payload: Omit<GitActionPayload, 'actionId'>, options?: RunOptions): Promise<ActionOutcome>;
    /* Every job in order under one toast, which is what pushing a folder of repositories is. */
    runMany(jobs: readonly ManyJob[], options?: ManyOptions): Promise<ManyOutcome>;
}

/*
 * One repository after another under one toast that counts. A repository that fails does not stop the
 * run, so the summary is where the outcome is read; cancel breaks off the running turn only.
 */
export async function runManyJobs(
    jobs: readonly ManyJob[],
    toastByAction: Map<string, { toastId: string; title: string | null }>,
    options: ManyOptions = {},
    runKind: (payload: GitActionPayload) => Promise<GitActionResult> = runGitKind
): Promise<ManyOutcome> {
    if (jobs.length === 0) {
        return { done: 0, failed: 0, diverged: [] };
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
    const diverged: ManyJob[] = [];
    let done = 0;
    for (const [index, job] of jobs.entries()) {
        if (stopped) {
            break;
        }
        const actionId = nextActionId();
        const title = manyTitle(job.kind, job.label, index, jobs.length);
        running = actionId;
        toastByAction.set(actionId, { toastId, title });
        useToasts.getState().update(toastId, { title, description: undefined });
        try {
            await runKind({ cwd: job.cwd, kind: job.kind, actionId, ...job.extra });
            done += 1;
        } catch (error: unknown) {
            if (error instanceof ActionRefusal && error.code === 'diverged') {
                diverged.push(job);
            } else {
                const message = error instanceof Error ? error.message : i18next.t('panels:error.generic');
                failed.push(job.label);
                outputs.push(`${job.label}: ${message}`);
            }
        } finally {
            running = null;
            toastByAction.delete(actionId);
        }
    }
    const choose = options.choose;
    const asks = diverged.map((job) => ({ label: i18next.t('panels:git.many.choose', { repo: job.label }), run: () => choose?.(job) }));
    const description = outputs.length > 0 ? outputs[0]!.split('\n')[0] : diverged.length > 0 ? i18next.t('panels:git.dialog.diverged.description') : undefined;
    useToasts.getState().show({
        id: toastId,
        title: manySummary(
            done,
            failed,
            diverged.map((job) => job.label)
        ),
        kind: failed.length === 0 && diverged.length === 0 ? 'success' : 'error',
        ...(description === undefined ? {} : { description }),
        ...(outputs.length === 0 ? {} : { output: outputs.join('\n\n') }),
        ...(choose === undefined || asks.length === 0 ? {} : { actions: asks })
    });
    return { done, failed: failed.length, diverged };
}

/* Running the panel's actions and saying how they went. */
export function useGitActions(): GitActions {
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

    const runMany = useCallback(
        (jobs: readonly ManyJob[], options?: ManyOptions): Promise<ManyOutcome> => runManyJobs(jobs, toastByAction.current, options),
        []
    );

    return useMemo(() => ({ run, runMany }), [run, runMany]);
}
