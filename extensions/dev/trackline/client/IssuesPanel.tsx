import { canvas, host, useLocale, useServer, useServerEvent, useSetting } from '@ruimte/extension/client';
import { Button } from '@ruimte/extension/ui';
import type { TracklineServer } from '../server/index';
import { ISSUE_NODE, shownIssues } from './issues';

function putOnCanvas(key: string): void {
    const node = canvas.createNode(ISSUE_NODE, { data: { key }, title: key });

    if (!node.ok) {
        host.notify(node.error.message, { tone: 'error' });

        return;
    }

    canvas.reveal(node.value);
}

export default function IssuesPanel({ params }: { params: { issue: string } | undefined }) {
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
        return <div style={{ padding: 12, color: 'var(--text-muted)' }}>{t('connect')}</div>;
    }

    const shown = shownIssues(issues.value, account.ok ? account.value : null, show);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
            <span style={{ color: 'var(--text-muted)' }}>{t('open', { count: shown.filter((issue) => issue.state === 'open').length })}</span>
            {shown.map((issue) => (
                <div
                    key={issue.key}
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 4,
                        padding: 8,
                        borderRadius: 8,
                        border: `1px solid ${issue.key === params?.issue ? 'var(--accent)' : 'var(--border)'}`
                    }}
                >
                    <strong>
                        {issue.key} {issue.title}
                    </strong>
                    <span style={{ color: 'var(--text-muted)' }}>
                        {issue.assignee}, {issue.labels.join(', ')}
                        {issue.working ? `, ${t('working')}` : ''}
                    </span>
                    {issue.key === params?.issue && <span>{issue.body}</span>}
                    <Button onClick={() => putOnCanvas(issue.key)}>{t('place')}</Button>
                </div>
            ))}
        </div>
    );
}
