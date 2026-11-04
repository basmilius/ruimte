import { IconButton } from '@adecore/ui';
import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { awaitingApproval, runsWaiting } from '@/routines/agenda';
import { useRoutineList } from '@/routines/routine-list';
import { toggleRoutines } from '@/routines/stage';
import { COMMANDS } from '@/shell/command-table';
import { useEndpointId } from '@/state/keys';

/* The clock in the rail, with a dot while a routine waits for approval or a run waits for a person. Absent on a machine without routines. */
export function RoutinesButton() {
    const { t } = useTranslation('routines');
    const endpointId = useEndpointId();
    const list = useRoutineList(endpointId);
    if (list === null) {
        return null;
    }
    const entries = list.status === 'ready' ? list.result.routines : [];
    const attention = awaitingApproval(entries).length + runsWaiting(entries).length;
    return (
        <IconButton
            icon={Clock}
            label={attention > 0 ? t('toolbar.attention', { count: attention }) : t('toolbar.routines')}
            kbd={COMMANDS.routines.shortcut}
            tooltipSide="left"
            className={attention > 0 ? 'relative' : undefined}
            onClick={toggleRoutines}
        >
            {attention > 0 && <span aria-hidden="true" className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-status-needs-you" />}
        </IconButton>
    );
}
