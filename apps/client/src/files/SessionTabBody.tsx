import { EmptyState } from '@adecore/ui';
import { useTranslation } from 'react-i18next';
import { CompareBody } from '@/files/CompareBody';
import { SnapshotBody } from '@/files/SnapshotBody';
import { useEndpointId } from '@/state/current-endpoint';
import type { SessionTab } from '@/state/files';
import { machineAnswers } from '@/transport/features';
import { useEndpointConnection } from '@/transport/status';

/* A comparison or a snapshot, once the machine is there and knows the requests they need. */
export function SessionTabBody({ tab }: { tab: SessionTab }) {
    const { t } = useTranslation('panels');
    const connection = useEndpointConnection(useEndpointId());

    if (connection.status !== 'open') {
        return <EmptyState>{t('git.compare.offline')}</EmptyState>;
    }

    if (!machineAnswers(connection, tab.kind === 'compare' ? 'git.compare' : 'git.blob')) {
        return <EmptyState>{t('git.compare.update')}</EmptyState>;
    }

    return tab.kind === 'compare' ? <CompareBody tab={tab} /> : <SnapshotBody tab={tab} />;
}
