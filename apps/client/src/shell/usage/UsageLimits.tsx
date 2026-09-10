import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { UsageLimitsProvider, UsageWindow } from '@ruimte/contracts';
import { useUsage } from '@/state/usage';
import { transport } from '@/transport';
import { SECTION_LABEL } from '@/ui/classes';
import { Tooltip } from '@/ui/Tooltip';
import { ProviderLogo } from '@/ui/ProviderLogo';
import { PROVIDER_COLORS, PROVIDER_LABELS } from '@/shell/usage/format';

/* Red where a window is nearly spent, amber where it is worth knowing. A window with room to spare
   is not news, so it takes the text color rather than a hue that competes with the two that are. */
const toneOf = (used: number): string => (used >= 0.9 ? 'bg-status-error' : used >= 0.7 ? 'bg-status-needs-you' : 'bg-text');

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const WEEKDAY_CLOCK = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* A time of day when the reset is today, a weekday and a time when it is not. */
const resetAtLabel = (resetsAt: number, now: number): string => {
    const at = new Date(resetsAt);
    const today = new Date(now);
    const sameDay = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate();
    return (sameDay ? CLOCK : WEEKDAY_CLOCK).format(at);
};

/* How long the window still has, at the coarsest unit that still says something: `4d`, `3h 12m`, `9m`. */
const resetInLabel = (resetsAt: number, now: number): string | null => {
    const left = resetsAt - now;
    if (left <= 0) {
        return null;
    }
    if (left >= DAY) {
        return `${Math.floor(left / DAY)}d ${Math.round((left % DAY) / HOUR)}h`;
    }
    if (left >= HOUR) {
        return `${Math.floor(left / HOUR)}h ${Math.round((left % HOUR) / MINUTE)}m`;
    }
    return `${Math.max(1, Math.round(left / MINUTE))}m`;
};

/* How much of the window has run, or null when the provider named neither a reset nor a length. */
const elapsedShare = (window: UsageWindow, now: number): number | null => {
    if (window.resetsAt === null || window.durationMs === null || window.durationMs <= 0) {
        return null;
    }
    return Math.min(1, Math.max(0, 1 - (window.resetsAt - now) / window.durationMs));
};

function WindowBar({ window, now }: { window: UsageWindow; now: number }) {
    const percent = Math.round(window.used * 100);
    const elapsed = elapsedShare(window, now);
    // The bar fills as the quota is spent, so the mark beside it is how much of the window has run.
    const mark = elapsed === null ? null : Math.round(elapsed * 100);
    const resetsAt = window.resetsAt === null ? null : resetAtLabel(window.resetsAt, now);
    const resetsIn = window.resetsAt === null ? null : resetInLabel(window.resetsAt, now);

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2 text-xs">
                <span className="text-text">{window.label}</span>
                <span className="ml-auto tabular-nums text-text-muted">{percent}% used</span>
            </div>
            <Tooltip
                label={
                    <span className="flex flex-col gap-0.5">
                        <span>
                            {percent}% used{mark !== null && ` · ${mark}% of the window gone`}
                        </span>
                        {mark !== null && (
                            <span className="text-text-muted">
                                {mark <= percent ? 'Spending faster than the window gives back.' : 'Spending slower than the window gives back.'}
                            </span>
                        )}
                    </span>
                }
            >
                <div
                    role="progressbar"
                    aria-label={`${window.label}, ${percent}% used`}
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="relative h-6 cursor-default"
                >
                    <div className="absolute inset-x-0 inset-y-1.5 rounded-full bg-surface-sunken" />
                    {/* Past a hundred there is nothing left to fill, so the bar stops rather than overflows. */}
                    <div className={clsx('absolute inset-y-1.5 left-0 rounded-full', toneOf(window.used))} style={{ width: `${Math.min(100, percent)}%` }} />
                    {/* Past the mark is spending faster than the window gives back, short of it slower. */}
                    {mark !== null && (
                        // Inside the fill the line has to be cut out of it, outside it drawn on the track.
                        <span
                            aria-hidden
                            className={clsx('absolute inset-y-0.5 w-px -translate-x-1/2', mark <= percent ? 'bg-surface' : 'bg-text-muted')}
                            style={{ left: `${mark}%` }}
                        />
                    )}
                </div>
            </Tooltip>
            {/* Under the bar rather than beside the label: a weekday and a countdown are too long to
                share that line, and a reset that wrapped would read as two of them. */}
            {resetsAt !== null && (
                <p className="text-xs whitespace-nowrap text-text-faint">
                    Resets {resetsAt}
                    {resetsIn !== null && ` · ${resetsIn}`}
                </p>
            )}
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

/* A countdown that stands still lies within the minute; this is the cheapest way to keep it honest. */
const useMinute = (): number => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), MINUTE);
        return () => clearInterval(timer);
    }, []);
    return now;
};

/*
 * What is left of each plan, asked of the CLIs themselves. Nothing here reads a credential: both
 * CLIs hold their own login and answer the question when the daemon starts one and asks.
 */
export function UsageLimits() {
    const limits = useUsage((s) => s.limits);
    const now = useMinute();

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
            <p className="text-xs text-text-muted">
                The mark on a bar is how much of its window has passed. A bar that has run past its mark is spending faster than the window gives back.
            </p>
            <div className="flex flex-col gap-6">
                {limits.providers.map((provider) => {
                    const note = explain(provider);
                    return (
                        <div key={provider.kind} className="flex flex-col gap-2">
                            <p className="flex items-center gap-2 text-xs font-medium">
                                <span style={{ color: PROVIDER_COLORS[provider.kind] }}>
                                    <ProviderLogo provider={provider.kind} />
                                </span>
                                {PROVIDER_LABELS[provider.kind]}
                                {provider.plan !== null && <span className="text-text-muted">· {provider.plan}</span>}
                            </p>
                            {note === null ? (
                                <div className="flex flex-col gap-4">
                                    {provider.windows.map((window) => (
                                        <WindowBar key={window.id} window={window} now={now} />
                                    ))}
                                </div>
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
