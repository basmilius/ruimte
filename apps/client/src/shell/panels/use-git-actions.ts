import { useCallback, useEffect, useMemo, useRef } from 'react';
import i18next from 'i18next';
import type { GitActionKind, GitActionPayload, GitActionResult } from '@ruimte/contracts';
import { actionTitle, manySummary, manyTitle, phaseLabel } from '@/shell/panels/git-actions';
import { useToasts, type ToastAction } from '@/state/toasts';
import { TransportError } from '@/transport/transport';
import { useTransport } from '@/transport/context';

let counter = 0;

/* Names one run, so the progress of this push is not drawn on the toast of the one before it. */
export const nextActionId = (): string => {
    counter += 1;
    return `git-${Date.now()}-${counter}`;
};

export type ActionOutcome = { ok: true; result: GitActionResult } | { ok: false; message: string; code: string | null };

/* One repository's turn in a run over several of them. */
export interface ManyJob {
    cwd: string;
    kind: GitActionKind;
    /* What the toast calls this repository while its turn runs. */
    label: string;
    /* Everything else the action takes, such as the message of a commit. */
    extra?: Record<string, unknown>;
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

    const run = useCallback(
        async (payload: Omit<GitActionPayload, 'actionId'>, options: RunOptions = {}): Promise<ActionOutcome> => {
            const actionId = nextActionId();
            const toasts = useToasts.getState();
            const toastId = toasts.show({
                title: actionTitle(payload.kind),
                kind: 'progress',
                action: {
                    label: i18next.t('common:action.cancel'),
                    run: () => void transport.request('git.cancel', { actionId }).catch(() => undefined)
                }
            });
            toastByAction.current.set(actionId, { toastId, title: null });
            try {
                const result = await transport.request('git.action', { ...payload, actionId });
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
                const code = error instanceof TransportError ? error.code : null;
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
        },
        [transport]
    );

    /*
     * One repository after another, never two at once: a folder of nine pushes over one link, and
     * nine toasts would say less than one that counts. A commit over several of them is the same run
     * with the same message. A repository that fails does not stop it, so the summary at the end is
     * where the whole outcome is read; cancel breaks off the turn that is running and leaves the rest
     * alone.
     */
    const runMany = useCallback(
        async (jobs: readonly ManyJob[]): Promise<{ done: number; failed: number }> => {
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
                            void transport.request('git.cancel', { actionId: running }).catch(() => undefined);
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
                    await transport.request('git.action', { cwd: job.cwd, kind: job.kind, actionId, ...job.extra });
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
        },
        [transport]
    );

    return useMemo(() => ({ run, runMany }), [run, runMany]);
};
