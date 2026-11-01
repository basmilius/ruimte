import { useUsageLimits } from '@ruimte/extension/client';

const NEAR_LIMIT = 0.7;

export default function LimitsCard() {
    const providers = useUsageLimits();
    const rows = providers.flatMap((provider) =>
        provider.windows.map((window) => ({ key: `${provider.provider}/${window.label}`, label: `${provider.provider}, ${window.label}`, used: window.used }))
    );

    if (rows.length === 0) {
        return <div style={{ color: 'var(--text-muted)' }}>No plan windows yet.</div>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((row) => (
                <div key={row.key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span>{row.label}</span>
                        <span>{Math.round(row.used * 100)}%</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, overflow: 'hidden', background: 'var(--surface-active)' }}>
                        <div
                            style={{
                                height: '100%',
                                width: `${Math.round(row.used * 100)}%`,
                                background: row.used >= NEAR_LIMIT ? 'var(--status-needs-you)' : 'var(--accent)'
                            }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}
