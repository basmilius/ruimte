import clsx from 'clsx';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import type { UsageLimitsProvider, UsageLimitsSnapshot, UsageWindow } from '@ruimte/contracts';
import { Tooltip } from '@/ui/Tooltip';
import { ProviderLogo } from '@/ui/ProviderLogo';
import { formatClock, formatWeekdayClock, isSameDay } from '@/format/datetime';
import { formatCountdown } from '@/format/duration';
import { PROVIDER_COLORS, PROVIDER_LABELS } from '@/shell/usage/format';

/* Red where a window is nearly spent, amber where it is worth knowing. A window with room to spare
   is not news, so it takes the text color rather than a hue that competes with the two that are. */
const toneOf = (used: number): string => (used >= 0.9 ? 'bg-status-error' : used >= 0.7 ? 'bg-status-needs-you' : 'bg-text');

/* A time of day when the reset is today, a weekday and a time when it is not. */
const resetAtLabel = (resetsAt: number, now: number): string => (isSameDay(resetsAt, now) ? formatClock(resetsAt) : formatWeekdayClock(resetsAt));

/* How long the window still has, or nothing once it has run out. */
const resetInLabel = (resetsAt: number, now: number): string | null => (resetsAt <= now ? null : formatCountdown(resetsAt - now));

/* How much of the window has run, or null when the provider named neither a reset nor a length. */
const elapsedShare = (window: UsageWindow, now: number): number | null => {
    if (window.resetsAt === null || window.durationMs === null || window.durationMs <= 0) {
        return null;
    }
    return Math.min(1, Math.max(0, 1 - (window.resetsAt - now) / window.durationMs));
};

function WindowBar({ window, now, compact }: { window: UsageWindow; now: number; compact: boolean }) {
    const { t } = useTranslation('usage');
    const percent = Math.round(window.used * 100);
    const elapsed = elapsedShare(window, now);
    // The bar fills as the quota is spent, so the mark beside it is how much of the window has run.
    const mark = elapsed === null ? null : Math.round(elapsed * 100);
    const resetsAt = window.resetsAt === null ? null : resetAtLabel(window.resetsAt, now);
    const resetsIn = window.resetsAt === null ? null : resetInLabel(window.resetsAt, now);

    const bar = (
        <div
            role="progressbar"
            aria-label={t('limits.bar', { window: window.label, percent })}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className={clsx('relative cursor-default', compact ? 'h-4' : 'h-6')}
        >
            <div className={clsx('absolute inset-x-0 rounded-full bg-surface-sunken', compact ? 'inset-y-1' : 'inset-y-1.5')} />
            {/* Past a hundred there is nothing left to fill, so the bar stops rather than overflows. */}
            <div
                className={clsx('absolute left-0 rounded-full', compact ? 'inset-y-1' : 'inset-y-1.5', toneOf(window.used))}
                style={{ width: `${Math.min(100, percent)}%` }}
            />
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
    );

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2 text-xs">
                <span className="text-text">{window.label}</span>
                <span className="ml-auto tabular-nums text-text-muted">{t('limits.used', { percent })}</span>
            </div>
            {compact ? (
                bar
            ) : (
                <Tooltip
                    label={
                        <span className="flex flex-col gap-0.5">
                            <span>
                                {t('limits.used', { percent })}
                                {mark !== null && ` · ${t('limits.windowPassed', { percent: mark })}`}
                            </span>
                            {mark !== null && <span className="text-text-muted">{mark <= percent ? t('limits.faster') : t('limits.slower')}</span>}
                        </span>
                    }
                >
                    {bar}
                </Tooltip>
            )}
            {/* Under the bar rather than beside the label. A weekday and a countdown are too long to
                share that line, and a reset that wrapped would read as two of them. */}
            {resetsAt !== null && (
                <p className="text-xs whitespace-nowrap text-text-faint">
                    {t('limits.resets', { at: resetsAt })}
                    {resetsIn !== null && ` · ${resetsIn}`}
                </p>
            )}
        </div>
    );
}

const explain = (provider: UsageLimitsProvider): string | null => {
    if (provider.unavailable === null) {
        return provider.windows.length === 0 ? i18next.t('usage:limits.none') : null;
    }
    if (provider.unavailable.reason === 'not-installed') {
        return i18next.t('usage:limits.notInstalled');
    }
    if (provider.unavailable.reason === 'no-subscription') {
        return i18next.t('usage:limits.noSubscription');
    }
    return provider.unavailable.message ?? i18next.t('usage:limits.unreachable');
};

interface LimitsListProps {
    limits: UsageLimitsSnapshot;
    now: number;
    /* Shorter bars, and no tooltip of their own, what a list that is itself a hover card needs. */
    compact?: boolean;
}

/* Every provider with what its plan has left, shared by the usage page and the sidebar card. */
export function LimitsList({ limits, now, compact = false }: LimitsListProps) {
    return (
        <div className={clsx('flex flex-col', compact ? 'gap-4' : 'gap-6')}>
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
                            <div className={clsx('flex flex-col', compact ? 'gap-3' : 'gap-4')}>
                                {provider.windows.map((window) => (
                                    <WindowBar key={window.id} window={window} now={now} compact={compact} />
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-text-faint">{note}</p>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
