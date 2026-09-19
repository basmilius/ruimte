import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Worktree } from '@ruimte/contracts';
import { GitPrompt } from '@/shell/panels/GitDialogs';
import { removeAllQuestion, removedToast } from '@/shell/panels/worktree-rows';
import { useEndpointId } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { worktreeLists } from '@/state/worktrees';
import { TransportError } from '@/transport';
import { useTransport } from '@/transport/context';

type Reading = { key: string; worktrees: Worktree[]; failure: string | null };

/*
 * The question before worktrees go, one from the git panel or a node's menu, or a group's all. It
 * counts the work again when it opens rather than trusting a list that may be minutes old, and it only
 * sends `force` when the numbers it showed said something would be lost: the daemon refuses anything
 * else with work in it, so a count that grew in between comes back here as a new question. With work
 * in one, merging first is offered next to removing.
 */
export function RemoveWorktreeDialog() {
    const { t } = useTranslation(['shell', 'common']);
    const removal = useUi((s) => s.worktreeRemoval);
    const endpointId = useEndpointId();
    const transport = useTransport();
    const [reading, setReading] = useState<Reading | null>(null);
    const [busy, setBusy] = useState(false);
    // Goes up to count again after a refusal, with the dialog still open on the same worktrees.
    const [attempt, setAttempt] = useState(0);
    const key = removal === null ? null : removal.paths.join('\u0000');

    useEffect(() => {
        if (removal === null || key === null) {
            return;
        }
        let cancelled = false;
        transport
            .request('git.worktree-list', { repo: removal.folder, inspect: true })
            .then((answer) => {
                if (!cancelled) {
                    const worktrees = removal.paths.map((path) => answer.worktrees.find((entry) => entry.path === path)).filter((entry) => entry !== undefined);
                    setReading({ key, worktrees, failure: worktrees.length === 0 ? t('removeWorktree.alreadyGone') : null });
                }
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    setReading({ key, worktrees: [], failure: error instanceof Error ? error.message : t('removeWorktree.unreadable') });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [transport, removal, key, attempt]);

    const close = (): void => {
        setReading(null);
        useUi.getState().setWorktreeRemoval(null);
    };

    const shown = key !== null && reading?.key === key ? reading : null;
    const question = shown !== null && shown.worktrees.length > 0 ? removeAllQuestion(shown.worktrees) : null;
    const mergeable = shown?.worktrees.filter((worktree) => !worktree.missing) ?? [];

    const confirm = async (): Promise<void> => {
        if (removal === null || shown === null || question === null) {
            return;
        }
        setBusy(true);
        try {
            // One after the other, stopping at the first refusal so what follows it stays as it was.
            for (const worktree of shown.worktrees) {
                const result = await transport.request('git.worktree-remove', {
                    repo: removal.folder,
                    path: worktree.path,
                    ...(question.force ? { force: true } : {})
                });
                useToasts.getState().show({
                    title: t('removeWorktree.removed', { branch: worktree.branch }),
                    ...(removedToast(worktree.branch, result) ?? {}),
                    kind: 'success'
                });
            }
            close();
        } catch (error: unknown) {
            if (error instanceof TransportError && error.code === 'worktree-has-work') {
                setReading(null);
                setAttempt((count) => count + 1);
                return;
            }
            close();
            const message = error instanceof Error ? error.message : t('removeWorktree.didNotWork');
            useToasts.getState().show({ title: t('removeWorktree.failed'), description: message, kind: 'error', output: message });
        } finally {
            setBusy(false);
            worktreeLists.reload(endpointId, removal.folder);
        }
    };

    return (
        <GitPrompt
            open={removal !== null}
            title={question?.title ?? t('removeWorktree.title')}
            description={
                shown === null ? (
                    t('removeWorktree.counting')
                ) : shown.failure !== null ? (
                    shown.failure
                ) : (
                    <>
                        {question?.description}
                        {question?.note !== undefined && <span className="mt-1 block">{question.note}</span>}
                    </>
                )
            }
            confirmLabel={question?.confirmLabel ?? t('common:action.remove')}
            danger
            busy={busy || question === null}
            secondary={
                removal !== null && question?.force === true && mergeable.length > 0
                    ? {
                          label: t('removeWorktree.mergeFirst'),
                          onClick: () => {
                              close();
                              useUi.getState().setWorktreeMerge({ folder: removal.folder, paths: mergeable.map((worktree) => worktree.path), remove: true });
                          }
                      }
                    : undefined
            }
            onConfirm={() => void confirm()}
            onClose={close}
        />
    );
}
