import { useEffect } from 'react';
import clsx from 'clsx';
import type { UsageLimitsProvider, UsageWindow } from '@ruimte/contracts';
import { useUsage } from '@/state/usage';
import { transport } from '@/transport';
import { SECTION_LABEL } from '@/ui/classes';
import { PROVIDER_LABELS } from '@/shell/usage/format';

/* Red where a window is nearly spent, amber where it is worth knowing, the accent everywhere else. */
const toneOf = (used: number): string => (used >= 0.9 ? 'bg-status-error' : used >= 0.7 ? 'bg-status-needs-you' : 'bg-accent');

const CLOCK = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const WEEKDAY_CLOCK = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/* A time of day when the reset is today, a weekday and a time when it is not. No ticking clock. */
const resetLabel = (resetsAt: number | null): string => {
    if (resetsAt === null) {
        return '';
    }
    const at = new Date(resetsAt);
    const today = new Date();
    const sameDay = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate();
    return `resets ${sameDay ? CLOCK.format(at) : WEEKDAY_CLOCK.format(at)}`;
};

function WindowBar({ window }: { window: UsageWindow }) {
    const percent = Math.round(window.used * 100);
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2 text-xs">
                <span className="text-text">{window.label}</span>
                <span className="ml-auto tabular-nums text-text-muted">{percent}%</span>
                <span className="w-28 text-right text-text-faint">{resetLabel(window.resetsAt)}</span>
            </div>
            <div
                className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
                role="progressbar"
                aria-label={window.label}
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
            >
                {/* Past a hundred there is nothing left to fill, so the bar stops rather than overflows. */}
                <div className={clsx('h-full rounded-full', toneOf(window.used))} style={{ width: `${Math.min(100, percent)}%` }} />
            </div>
        </div>
    );
}

const explain = (provider: UsageLimitsProvider): string | null => {
    if (provider.unavailable === null) {
        return provider.windows.length === 0 ? 'No windows reported yet.' : null;
    }
    if (provider.unavailable.reason === 'not-installed') {
        return 'Not installed on this machine.';
    }
    if (provider.unavailable.reason === 'no-subscription') {
        return 'This account runs on an API key, which has no plan windows.';
    }
    return provider.unavailable.message ?? 'The CLI could not be reached.';
};

/*
 * What is left of each plan, asked of the CLIs themselves. Nothing here reads a credential: both
 * CLIs hold their own login and answer the question when the daemon starts one and asks.
 */
export function UsageLimits() {
    const limits = useUsage((s) => s.limits);

    useEffect(() => {
        transport
            .request('usage.limits', {})
            .then((snapshot) => useUsage.getState().setLimits(snapshot))
            .catch(() => undefined);
        // A running turn reports its own numbers, which is what keeps a bar moving between reads.
        return transport.on('usage.limitsChanged', (snapshot) => useUsage.getState().setLimits(snapshot));
    }, []);

    if (limits === null) {
        return null;
    }
    return (
        <section className="flex flex-col gap-3">
            <h2 className={SECTION_LABEL}>Limits</h2>
            <div className="grid gap-6 md:grid-cols-2">
                {limits.providers.map((provider) => {
                    const note = explain(provider);
                    return (
                        <div key={provider.kind} className="flex flex-col gap-2">
                            <p className="text-xs font-medium">
                                {PROVIDER_LABELS[provider.kind]}
                                {provider.plan !== null && <span className="text-text-muted"> · {provider.plan}</span>}
                            </p>
                            {note === null ? (
                                provider.windows.map((window) => <WindowBar key={window.id} window={window} />)
                            ) : (
                                <p className="text-xs text-text-faint">{note}</p>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
