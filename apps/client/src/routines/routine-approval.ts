import { messageOf } from '@adecore/ui';
import { isExternalActor, type RoutineEntry } from '@ruimte/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { refreshRoutines } from '@/routines/routine-list';
import { machineTransport } from '@/transport';

export function useRoutineApproval(endpointId: string, entry: RoutineEntry) {
    const { t } = useTranslation('routines');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const madeBy = entry.madeBy;
    const origin =
        madeBy === undefined
            ? t(entry.shared ? 'approval.fromOutside' : 'approval.fromOutsidePrivate')
            : isExternalActor(madeBy.chatId) && madeBy.title !== undefined
              ? t('approval.byClient', { title: madeBy.title })
              : t('approval.byAgent', { title: madeBy.title ?? t('approval.anAgent') });
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
