import { useTranslation } from 'react-i18next';
import { MachineCard } from '@/shell/MachineCard';
import { useMachineEntry } from '@/shell/use-machine-entry';
import { nameOf } from '@/shell/settings/machine-list';
import { pool } from '@/transport';
import type { RemoteNodeState } from '@/canvas/remote-node-state';
import { Button } from '@adecore/ui';

/*
 * The body of a node whose machine is not there: which machine, when it last answered, and what
 * can be done. It is the card the whole window shows when its own machine is lost, for one node
 * (`shell/MachineLostScreen.tsx`); the other nodes of the canvas keep working.
 */
export function RemoteNodeOffline({
    machine,
    state,
    task,
    onLinkAgain
}: {
    machine: string;
    /* `unstarted` is a machine that answers this window while the daemon that gave the task cannot reach it yet. */
    state: Exclude<RemoteNodeState, 'ready'> | 'unstarted';
    /* The title of the task of this node that its machine has not taken yet. */
    task?: string | undefined;
    onLinkAgain(): void;
}) {
    const { t } = useTranslation(['canvas', 'common']);
    const name = nameOf(useMachineEntry(machine));
    const connecting = state === 'connecting';
    return (
        <div className="grid h-full place-items-center bg-surface" role="status" aria-live="polite">
            <MachineCard
                machine={machine}
                seen={state === 'connecting' || state === 'offline'}
                line={t(`remote.${state === 'too-old' ? 'tooOld' : state === 'connecting' ? 'retrying' : state}`, { machine: name })}
                failed={!connecting && state !== 'unstarted'}
            >
                {task !== undefined && <span className="text-sm text-text-muted">{t('remote.taskNotStarted', { title: task })}</span>}
                {(state === 'connecting' || state === 'offline') && (
                    <Button size="sm" variant="primary" disabled={connecting} onClick={() => pool.reconnect(machine)}>
                        {t('common:action.retry')}
                    </Button>
                )}
                {state === 'unlinked' && (
                    <Button size="sm" variant="secondary" onClick={onLinkAgain}>
                        {t('remote.linkAgain')}
                    </Button>
                )}
            </MachineCard>
        </div>
    );
}
