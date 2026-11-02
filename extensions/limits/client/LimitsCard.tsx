import { useUsageLimits } from '@ruimte/extension/client';
import { limitRows } from './limit-rows';

export default function LimitsCard() {
    const rows = limitRows(useUsageLimits());

    if (rows.length === 0) {
        return <div style={{ color: 'var(--text-muted)' }}>No plan windows yet.</div>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((row) => (
                <div key={row.key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span>{row.label}</span>
                        <span>{row.percent}%</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, overflow: 'hidden', background: 'var(--surface-active)' }}>
                        <div style={{ height: '100%', width: `${row.percent}%`, background: row.near ? 'var(--status-needs-you)' : 'var(--accent)' }} />
                    </div>
                </div>
            ))}
        </div>
    );
}
