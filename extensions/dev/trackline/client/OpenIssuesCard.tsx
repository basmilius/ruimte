import { canvas, useLocale, useServer, useServerEvent, useSetting } from '@ruimte/extension/client';
import type { TracklineServer } from '../server/index';
import { shownIssues } from './issues';

export default function OpenIssuesCard() {
    const { t } = useLocale();
    const server = useServer<TracklineServer>();
    const account = server.account.use();
    const issues = server.issues.use();
    const show = { mine: useSetting<boolean>('mine'), closed: useSetting<boolean>('closed'), order: useSetting<string>('order') };

    useServerEvent('issues.changed', () => {
        server.account.reload();
        server.issues.reload();
    });

    if (!issues.ok) {
        return <div style={{ color: 'var(--text-muted)' }}>{t('connect')}</div>;
    }

    const shown = shownIssues(issues.value, account.ok ? account.value : null, show);

    if (shown.length === 0) {
        return <div style={{ color: 'var(--text-muted)' }}>{t('none')}</div>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {shown.map((issue) => {
                const { chat } = issue;

                // Only an issue with a chat leads anywhere: the chat a person started on it.
                return chat === null ? (
                    <span key={issue.key}>
                        {issue.key} {issue.title}
                    </span>
                ) : (
                    <button key={issue.key} type="button" style={{ textAlign: 'left' }} onClick={() => canvas.reveal({ id: chat })}>
                        {issue.key} {issue.title}
                        {issue.working ? ` (${t('working')})` : ''}
                    </button>
                );
            })}
        </div>
    );
}
