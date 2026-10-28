import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionRefusal } from '@ruimte/actions';
import type { Worktree } from '@ruimte/contracts';
import { perform } from '@/actions/client-actions';
import { PromptDialog, messageOf } from '@adecore/ui';
import { useChats } from '@adecore/agents-react/state';
import { nodeWorking } from '@/state/agent-work';
import { useSessions } from '@/state/sessions';
import { useProjectNodes } from '@/state/worktrees';
import { nodesInWorktree, removeAllQuestion, removedToast, worktreeSessionsOf } from '@/shell/panels/worktree-rows';
import { useEndpointId } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { worktreeLists } from '@/state/worktrees';
import { inspectWorktrees, nodeNames } from '@/shell/worktree-inspection';
import { useTransport } from '@/transport/context';

type Reading = { key: string; worktrees: Worktree[]; error: { message: string | null } | null };

/*
 * The question before worktrees go. It counts the work again when it opens, and sends `force` only when
 * the numbers it showed said something would be lost: the daemon refuses anything else with work in it,
 * so a count that grew in between comes back as a new question.
 */
export function RemoveWorktreeDialog() {
    const { t } = useTranslation(['shell', 'common']);
    const removal = useUi((s) => s.worktreeRemoval);
    const endpointId = useEndpointId();
    const transport = useTransport();
    // Per chat of a design, so the one working in a worktree is the one stopped.
    const nodes = worktreeSessionsOf(useProjectNodes());
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.statusByKey);
    const [reading, setReading] = useState<Reading | null>(null);
    const [busy, setBusy] = useState(false);
    // Goes up to count again after a refusal, with the dialog still open on the same worktrees.
    const [attempt, setAttempt] = useState(0);
    // Set once the machine said an agent is still working there, so the next confirm stops it first.
    const [agentWorking, setAgentWorking] = useState(false);
    const key = removal === null ? null : removal.paths.join('\u0000');

    useEffect(() => {
        if (removal === null || key === null) {
            return;
        }
        let cancelled = false;
        inspectWorktrees(transport, removal.folder, removal.paths)
            .then((worktrees) => {
                if (!cancelled) {
                    setReading({ key, worktrees, error: null });
                }
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    setReading({ key, worktrees: [], error: { message: error instanceof Error ? error.message : null } });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [transport, removal, key, attempt]);

    const close = (): void => {
        setReading(null);
        setAgentWorking(false);
        useUi.getState().setWorktreeRemoval(null);
    };

    const shown = key !== null && reading?.key === key ? reading : null;
    const failure =
        shown === null
            ? null
            : shown.error !== null
              ? (shown.error.message ?? t('removeWorktree.unreadable'))
              : shown.worktrees.length === 0
                ? t('removeWorktree.alreadyGone')
                : null;
    const question = shown !== null && shown.worktrees.length > 0 ? removeAllQuestion(shown.worktrees) : null;
    const working = (shown?.worktrees ?? [])
        .flatMap((worktree) => nodesInWorktree(nodes, worktree))
        .filter((node) => nodeWorking(node, sessions, chats, endpointId));
    const stopping = agentWorking || working.length > 0;
    const mergeable = shown?.worktrees.filter((worktree) => !worktree.missing) ?? [];

    const confirm = async (): Promise<void> => {
        if (removal === null || shown === null || question === null) {
            return;
        }
        setBusy(true);
        try {
            // One after the other, stopping at the first refusal so what follows it stays as it was.
            for (const worktree of shown.worktrees) {
                const result = await perform('worktree.remove', {
                    branch: worktree.branch,
                    force: question.force,
                    stopAgent: stopping
                });
                useToasts.getState().show({
                    title: t('removeWorktree.removed', { branch: worktree.branch }),
                    ...(removedToast(worktree.branch, result) ?? {}),
                    kind: 'success'
                });
            }
            close();
        } catch (error: unknown) {
            if (error instanceof ActionRefusal && error.code === 'agent-working') {
                setAgentWorking(true);
                return;
            }
            if (error instanceof ActionRefusal && error.code === 'worktree-has-work') {
                setReading(null);
                setAttempt((count) => count + 1);
                return;
            }
            close();
            const message = messageOf(error, t('removeWorktree.didNotWork'));
            useToasts.getState().show({ title: t('removeWorktree.failed'), description: message, kind: 'error', output: message });
        } finally {
            setBusy(false);
            worktreeLists.reload(endpointId, removal.folder);
        }
    };

    return (
        <PromptDialog
            open={removal !== null}
            title={question?.title ?? t('removeWorktree.title')}
            description={
                shown === null ? (
                    t('removeWorktree.counting')
                ) : failure !== null ? (
                    failure
                ) : (
                    <>
                        {question?.description}
                        {question?.note !== undefined && <span className="mt-1 block">{question.note}</span>}
                        {stopping && (
                            <span className="mt-2 block text-sm text-status-needs-you">
                                {working.length > 0
                                    ? t('removeWorktree.working', { count: working.length, names: nodeNames(working) })
                                    : t('removeWorktree.agentWorking')}
                            </span>
                        )}
                    </>
                )
            }
            confirmLabel={stopping ? t('removeWorktree.stopAndRemove') : (question?.confirmLabel ?? t('common:action.remove'))}
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
            onOpenChange={close}
        />
    );
}
