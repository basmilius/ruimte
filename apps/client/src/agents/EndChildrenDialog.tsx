import { Switch, Button, Icon, Dialog, messageOf } from '@adecore/ui';
import type { Worktree } from '@ruimte/contracts';
import i18next from 'i18next';
import { Eraser, Square, Trash } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { perform } from '@/actions/client-actions';
import {
    clearsWarning,
    endingTitle,
    endsAgentsWarning,
    stopsSubagentsWarning,
    stopsTaskWarning,
    useEndingAgents,
    type PendingEnd
} from '@/agents/end-children';
import { hasWork, leftBehindLine, removedToast } from '@/shell/panels/worktree-rows';
import { useEndpointId } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import { worktreeLists } from '@/state/worktrees';

function warningOf(pending: PendingEnd | null): string | null {
    const agents = pending?.agents ?? 0;
    if (pending?.action === 'stop') {
        return stopsTaskWarning(agents);
    }
    if (pending?.action === 'stop-subagents') {
        return stopsSubagentsWarning(agents);
    }
    if (pending?.action === 'clear') {
        return clearsWarning(agents);
    }
    return agents === 0 ? null : endsAgentsWarning(agents);
}

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
    const clear = pending?.action === 'clear';
    const confirmIcon = clear ? Eraser : stop ? Square : Trash;
    const confirmLabel = clear ? 'dialog.clear' : stop ? 'dialog.stop' : 'dialog.delete';
    const warning = warningOf(pending);
    const offered = pending?.worktrees;
    const clean = offered?.worktrees.filter((worktree) => !hasWork(worktree.work)) ?? [];

    return (
        <Dialog.Root open={pending !== null} onOpenChange={(next) => !next && close()}>
            <Dialog.Popup size="sm">
                <Dialog.Title>{pending === null ? null : endingTitle(pending)}</Dialog.Title>
                {warning !== null && <Dialog.Text className="mt-1">{warning}</Dialog.Text>}
                {offered?.worktrees.map((worktree) => (
                    <Dialog.Text key={worktree.path} className="mt-1">
                        {leftBehindLine(worktree)}
                    </Dialog.Text>
                ))}
                {clean.length > 0 && (
                    <label className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-sm text-text">{t('dialog.removeWorktree', { count: clean.length })}</span>
                        <Switch
                            label={t('dialog.removeWorktreeToggle')}
                            checked={removal.remove}
                            onCheckedChange={(remove) => setRemoval({ pending, remove })}
                        />
                    </label>
                )}
                <Dialog.Footer>
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
                        <Icon icon={confirmIcon} size={12} /> {t(confirmLabel)}
                    </Button>
                </Dialog.Footer>
            </Dialog.Popup>
        </Dialog.Root>
    );
}

/* Without force, so a worktree that gained work since the question was asked is refused by the machine and stays. */
async function removeClean(worktrees: readonly Worktree[]): Promise<void> {
    for (const worktree of worktrees) {
        try {
            const result = await perform('worktree.remove', { branch: worktree.branch, force: false });
            useToasts.getState().show({
                title: i18next.t('agents:dialog.worktreeRemoved', { branch: worktree.branch }),
                ...(removedToast(worktree.branch, result) ?? {}),
                kind: 'success'
            });
        } catch (error: unknown) {
            const message = messageOf(error, i18next.t('agents:dialog.worktreeFailed'));
            useToasts
                .getState()
                .show({ title: i18next.t('agents:dialog.worktreeStays', { branch: worktree.branch }), description: message, kind: 'error', output: message });
        }
    }
}
