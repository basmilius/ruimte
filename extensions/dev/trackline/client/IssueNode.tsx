import { useLocale, useNodeData, useServer, useServerEvent } from '@ruimte/extension/client';
import type { TracklineServer } from '../server/index';

export default function IssueNode() {
    const { t } = useLocale();
    const [{ key }] = useNodeData<{ key: string }>();
    const server = useServer<TracklineServer>();
    const text = server.text.use(key);

    useServerEvent('issues.changed', () => server.text.reload(key));

    if (key === '') {
        return <div style={{ padding: 12, color: 'var(--text-muted)' }}>{t('pick')}</div>;
    }

    return <div style={{ padding: 12, whiteSpace: 'pre-wrap', overflow: 'auto', height: '100%' }}>{text.ok ? text.value : text.error.message}</div>;
}
