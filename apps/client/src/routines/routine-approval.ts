import { messageOf } from '@adecore/ui';
import type { RoutineEntry } from '@ruimte/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { refreshRoutines } from '@/routines/routine-list';
import { machineTransport } from '@/transport';

/* A person's yes or no to a routine as it was shown, and where it came from, for the card beside the week and the banner over a routine. */
export function useRoutineApproval(endpointId: string, entry: RoutineEntry) {
    const { t } = useTranslation('routines');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const origin =
        entry.madeBy !== undefined
            ? t('approval.byAgent', { title: entry.madeBy.title ?? t('approval.anAgent') })
            : t(entry.shared ? 'approval.fromOutside' : 'approval.fromOutsidePrivate');
    const answer = (type: 'routine.approve' | 'routine.decline'): void => {
        setBusy(true);
        setFailure(null);
        machineTransport(endpointId)
            .request(type, { projectId: entry.projectId, routineId: entry.routine.id, digest: entry.digest })
            .then(() => refreshRoutines(endpointId))
            .catch((e: unknown) => setFailure(messageOf(e, t('approval.failed'))))
            .finally(() => setBusy(false));
    };
    return { origin, busy, failure, approve: () => answer('routine.approve'), decline: () => answer('routine.decline') };
}
