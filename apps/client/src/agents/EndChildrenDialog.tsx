import { useState } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import i18next from 'i18next';
import { Square, Trash } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { performAsPerson } from '@/actions/client-actions';
import { endsAgentsWarning, stopsSubagentsWarning, stopsTaskWarning, useEndingAgents, type PendingEnd } from '@/agents/end-children';
import { hasWork, leftBehindLine, removedToast } from '@/shell/panels/worktree-rows';
import { Toggle } from '@/shell/settings/controls';
import { useEndpointId } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import { worktreeLists } from '@/state/worktrees';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

const warningOf = (pending: PendingEnd | null): string | null => {
    const agents = pending?.agents ?? 0;
    if (pending?.action === 'stop') {
        return stopsTaskWarning(agents);
    }
    if (pending?.action === 'stop-subagents') {
        return stopsSubagentsWarning(agents);
    }
    return agents === 0 ? null : endsAgentsWarning(agents);
};

/*
 * Asked before a delete that also ends the agents the deleted nodes opened, and before a stop that ends
 * agents, with how many. A delete that leaves a worktree behind says so, and offers to remove the ones
 * that hold no work along with the nodes; one with work stays, since nothing removes work on its own.
 */
export function EndChildrenDialog() {
    const { t } = useTranslation('agents');
    const { t: common } = useTranslation();
    const pending = useEndingAgents((s) => s.pending);
    const endpointId = useEndpointId();
    // Off for every new question. Removing a worktree is only ever what the person ticked this time.
    const [removal, setRemoval] = useState<{ pending: PendingEnd | null; remove: boolean }>({ pending: null, remove: false });
    if (removal.pending !== pending) {
        setRemoval({ pending, remove: false });
    }
    const close = (): void => useEndingAgents.setState({ pending: null });
    const stop = pending?.action === 'stop' || pending?.action === 'stop-subagents';
    const warning = warningOf(pending);
    const offered = pending?.worktrees;
    const clean = offered?.worktrees.filter((worktree) => !hasWork(worktree.work)) ?? [];

    return (
        <Dialog.Root open={pending !== null} onOpenChange={(next) => !next && close()}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup w-[420px] p-5">
                    <Dialog.Title className="text-base font-semibold text-text">
                        {stop ? t('dialog.stopTitle', { what: pending?.what }) : t('dialog.deleteTitle', { what: pending?.what })}
                    </Dialog.Title>
                    {warning !== null && <p className="mt-1 text-sm text-text-muted">{warning}</p>}
                    {offered?.worktrees.map((worktree) => (
                        <p key={worktree.path} className="mt-1 text-sm text-text-muted">
                            {leftBehindLine(worktree)}
                        </p>
                    ))}
                    {clean.length > 0 && (
                        <label className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-sm text-text">{t('dialog.removeWorktree', { count: clean.length })}</span>
                            <Toggle label={t('dialog.removeWorktreeToggle')} checked={removal.remove} onChange={(remove) => setRemoval({ pending, remove })} />
                        </label>
                    )}
                    <div className="mt-4 flex items-center justify-end gap-2">
                        <Button onClick={close}>{common('action.cancel')}</Button>
                        <Button
                            variant="danger"
                            onClick={() => {
                                pending?.run();
                                if (offered !== undefined && removal.remove) {
                                    void removeClean(clean).finally(() => worktreeLists.reload(endpointId, offered.folder));
                                }
                                close();
                            }}
                        >
                            <Icon icon={stop ? Square : Trash} size={12} /> {stop ? t('dialog.stop') : t('dialog.delete')}
                        </Button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/* Without force, so a worktree that gained work since the question was asked is refused by the machine and stays. */
const removeClean = async (worktrees: readonly PendingEndWorktree[]): Promise<void> => {
    for (const worktree of worktrees) {
        try {
            const result = await performAsPerson('worktree.remove', { branch: worktree.branch, force: false });
            useToasts.getState().show({
                title: i18next.t('agents:dialog.worktreeRemoved', { branch: worktree.branch }),
                ...(removedToast(worktree.branch, result) ?? {}),
                kind: 'success'
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : i18next.t('agents:dialog.worktreeFailed');
            useToasts
                .getState()
                .show({ title: i18next.t('agents:dialog.worktreeStays', { branch: worktree.branch }), description: message, kind: 'error', output: message });
        }
    }
};

type PendingEndWorktree = NonNullable<PendingEnd['worktrees']>['worktrees'][number];
