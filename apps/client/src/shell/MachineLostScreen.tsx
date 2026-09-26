import { useTranslation } from 'react-i18next';
import { leaveWorkspace, showStart } from '@/transport/connections';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { useProjectSwitch } from '@/project/open';
import { describeLastSeen } from '@/shell/connection-info';
import { machineLost } from '@/shell/machine-lost';
import { StatusCard } from '@/shell/ProjectSwitchScreen';
import { useMachineEntry } from '@/shell/use-machine-entry';
import { useMachineIcon } from '@/shell/settings/machine-icon';
import { nameOf } from '@/shell/settings/machine-list';
import { useEndpointId } from '@/state/keys';
import { pool } from '@/transport';
import { useEndpointConnection, useLastSeenAt } from '@/transport/status';
import { Button } from '@ruimte/ui/Button';
import { useNow } from '@ruimte/ui/useNow';

const MINUTE_MS = 60_000;

/*
 * Stands over the cells while the machine of the open project does not answer. Nothing of the
 * workspace goes: the nodes keep their sessions and threads, and the screen goes the moment the link
 * is back. Opening another project is a choice a person makes here, never something that happens.
 */
export function MachineLostScreen() {
    const { t } = useTranslation(['shell', 'common']);
    const endpointId = useEndpointId();
    const connection = useEndpointConnection(endpointId);
    const switching = useProjectSwitch((s) => s.kind !== 'idle');
    const entry = useMachineEntry(endpointId);
    const icon = useMachineIcon(entry);
    const lastSeen = useLastSeenAt(endpointId);
    const now = useNow(MINUTE_MS);

    // A switch has a screen of its own, which says more about the same wait.
    if (switching || !machineLost(connection)) {
        return null;
    }
    const seen = describeLastSeen(lastSeen, now);
    const retrying = connection.status === 'connecting';
    return (
        <div className="absolute inset-0 z-10 grid place-items-center bg-surface-sunken" role="status" aria-live="polite">
            <StatusCard
                glyph={<MachineGlyph icon={icon} size={24} className="text-text-faint" />}
                title={nameOf(entry)}
                meta={seen && <span className="text-xs text-text-muted">{seen}</span>}
                line={retrying ? t('machineLost.retrying') : (connection.failure ?? t('machineLost.silent'))}
                failed={!retrying}
            >
                <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                        void leaveWorkspace().then(showStart);
                    }}
                >
                    {t('machineLost.openAnother')}
                </Button>
                <Button size="sm" variant="primary" disabled={retrying} onClick={() => pool.reconnect(endpointId)}>
                    {t('common:action.retry')}
                </Button>
            </StatusCard>
        </div>
    );
}
