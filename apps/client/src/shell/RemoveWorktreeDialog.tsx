import { useEffect, useState } from 'react';
import type { Worktree } from '@ruimte/contracts';
import { GitPrompt } from '@/shell/panels/GitDialogs';
import { removedToast, removeQuestion } from '@/shell/panels/worktree-rows';
import { useEndpointId } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { worktreeLists } from '@/state/worktrees';
import { TransportError } from '@/transport';
import { useTransport } from '@/transport/context';

type Reading = { path: string; worktree: Worktree | null; failure: string | null };

/*
 * The question before a worktree goes, from the git panel and from a node's menu alike. It counts the
 * work again when it opens rather than trusting a list that may be minutes old, and it only sends
 * `force` when the numbers it showed said something would be lost: the daemon refuses anything else
 * with work in it, so a count that grew in between comes back here as a new question.
 */
export function RemoveWorktreeDialog() {
    const removal = useUi((s) => s.worktreeRemoval);
    const endpointId = useEndpointId();
    const transport = useTransport();
    const [reading, setReading] = useState<Reading | null>(null);
    const [busy, setBusy] = useState(false);
    // Goes up to count again after a refusal, with the dialog still open on the same worktree.
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (removal === null) {
            return;
        }
        let cancelled = false;
        transport
            .request('git.worktree-list', { repo: removal.folder, inspect: true })
            .then((answer) => {
                if (!cancelled) {
                    const worktree = answer.worktrees.find((entry) => entry.path === removal.path) ?? null;
                    setReading({ path: removal.path, worktree, failure: worktree === null ? 'This worktree is already gone.' : null });
                }
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    setReading({ path: removal.path, worktree: null, failure: error instanceof Error ? error.message : 'Could not read the worktree.' });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [transport, removal, attempt]);

    const close = (): void => {
        setReading(null);
        useUi.getState().setWorktreeRemoval(null);
    };

    const shown = removal !== null && reading?.path === removal.path ? reading : null;
    const question = shown?.worktree ? removeQuestion(shown.worktree) : null;

    const confirm = (): void => {
        if (removal === null || shown?.worktree == null || question === null) {
            return;
        }
        const worktree = shown.worktree;
        setBusy(true);
        transport
            .request('git.worktree-remove', { repo: removal.folder, path: worktree.path, ...(question.force ? { force: true } : {}) })
            .then((result) => {
                close();
                useToasts.getState().show({
                    title: `Removed worktree ${worktree.branch}`,
                    ...(removedToast(worktree.branch, result) ?? {}),
                    kind: 'success'
                });
            })
            .catch((error: unknown) => {
                if (error instanceof TransportError && error.code === 'worktree-has-work') {
                    setReading(null);
                    setAttempt((count) => count + 1);
                    return;
                }
                close();
                const message = error instanceof Error ? error.message : 'That did not work.';
                useToasts.getState().show({ title: 'Removing the worktree failed', description: message, kind: 'error', output: message });
            })
            .finally(() => {
                setBusy(false);
                worktreeLists.reload(endpointId, removal.folder);
            });
    };

    return (
        <GitPrompt
            open={removal !== null}
            title={question?.title ?? 'Remove this worktree?'}
            description={shown === null ? 'Counting what is in it...' : (shown.failure ?? question?.description)}
            confirmLabel={question?.confirmLabel ?? 'Remove'}
            danger
            busy={busy || question === null}
            onConfirm={confirm}
            onClose={close}
        />
    );
}
