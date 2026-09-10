import { useCallback, useEffect, useRef } from 'react';
import type { GitActionPayload, GitActionResult } from '@ruimte/contracts';
import { actionTitle, phaseLabel } from '@/shell/panels/git-actions';
import { useToasts, type ToastAction } from '@/state/toasts';
import { transport } from '@/transport';

let counter = 0;

/* Names one run, so the progress of this push is not drawn on the toast of the one before it. */
export const nextActionId = (): string => {
    counter += 1;
    return `git-${Date.now()}-${counter}`;
};

export type ActionOutcome = { ok: true; result: GitActionResult } | { ok: false; message: string };

export interface RunOptions {
    /* A button on the toast that says it went well: what the action leads to next. */
    done?(result: GitActionResult): ToastAction | undefined;
}

/*
 * Running an action and saying so. One toast per run: it goes up the moment the request leaves,
 * follows the phases the daemon streams back, and ends as the summary or as the failure with the
 * output of the command behind a copy button. The caller gets the outcome, because some of them
 * have a second question to ask (deleting a branch git has not merged, for one).
 */
export const useGitActions = (): ((payload: Omit<GitActionPayload, 'actionId'>, options?: RunOptions) => Promise<ActionOutcome>) => {
    /* Which toast a running action writes to; an action that is over is not in here. */
    const toastByAction = useRef(new Map<string, string>());

    useEffect(() => {
        return transport.on('git.progress', (payload) => {
            const toastId = toastByAction.current.get(payload.actionId);
            if (toastId === undefined || payload.phase === 'done' || payload.phase === 'failed') {
                return;
            }
            useToasts.getState().update(toastId, { title: phaseLabel(payload.phase), ...(payload.line === '' ? {} : { description: payload.line }) });
        });
    }, []);

    return useCallback(async (payload, options = {}) => {
        const actionId = nextActionId();
        const toasts = useToasts.getState();
        const toastId = toasts.show({
            title: actionTitle(payload.kind),
            kind: 'progress',
            action: {
                label: 'Cancel',
                run: () => void transport.request('git.cancel', { actionId }).catch(() => undefined)
            }
        });
        toastByAction.current.set(actionId, toastId);
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
            const message = error instanceof Error ? error.message : 'That did not work.';
            useToasts
                .getState()
                .show({ id: toastId, title: `${actionTitle(payload.kind)} failed`, description: message.split('\n')[0], kind: 'error', output: message });
            return { ok: false, message };
        } finally {
            toastByAction.current.delete(actionId);
        }
    }, []);
};
