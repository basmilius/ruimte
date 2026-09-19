import { useTranslation } from 'react-i18next';
import { Popover } from '@base-ui-components/react/popover';
import { Minimize2 } from 'lucide-react';
import type { ChatUsage } from '@ruimte/contracts';
import { formatMoney } from '@/format/number';
import { Icon } from '@/ui/Icon';

const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const formatTokens = (count: number): string => (count >= 1000 ? `${Math.round(count / 1000)}k` : String(count));

/* A small ring for how full the context is; the popover has the numbers and the compact button. */
export function ContextMeter({ usage, disabled, onCompact }: { usage: ChatUsage; disabled: boolean; onCompact(): void }) {
    const { t } = useTranslation('chat');
    const fraction = usage.contextWindow ? Math.min(1, usage.contextTokens / usage.contextWindow) : 0;
    const percent = Math.round(fraction * 100);
    const tone = fraction > 0.85 ? 'text-status-error' : fraction > 0.6 ? 'text-status-needs-you' : 'text-accent';
    return (
        <Popover.Root>
            <Popover.Trigger className="icon-btn h-7 w-7" aria-label={t('contextMeter.aria', { percent })}>
                <svg width="24" height="24" viewBox="0 0 24 24" className={tone}>
                    <circle cx="12" cy="12" r={RADIUS} fill="none" strokeWidth="2" className="stroke-border" />
                    <circle
                        cx="12"
                        cy="12"
                        r={RADIUS}
                        fill="none"
                        strokeWidth="2"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeDasharray={CIRCUMFERENCE}
                        strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
                        transform="rotate(-90 12 12)"
                    />
                </svg>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Positioner side="top" sideOffset={8} align="end" className="z-(--z-popup)">
                    <Popover.Popup className="menu-popup min-w-56 p-3 text-xs text-text-muted">
                        <div className="flex items-baseline justify-between">
                            <span className="text-sm font-medium text-text">
                                {usage.contextWindow ? t('contextMeter.percent', { percent }) : t('contextMeter.title')}
                            </span>
                            <span className="tabular-nums">
                                {formatTokens(usage.contextTokens)}
                                {usage.contextWindow ? ` / ${formatTokens(usage.contextWindow)}` : ''}
                            </span>
                        </div>
                        <div className="mt-2 flex justify-between tabular-nums">
                            <span>{t('contextMeter.turns')}</span>
                            <span>{usage.turns}</span>
                        </div>
                        <div className="mt-1 flex justify-between tabular-nums">
                            <span>{t('contextMeter.cost')}</span>
                            <span>{formatMoney(usage.costUsd, 'USD')}</span>
                        </div>
                        <button
                            className="mt-3 flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-surface-sunken text-xs font-medium text-text hover:bg-border disabled:opacity-40"
                            disabled={disabled || usage.contextTokens === 0}
                            onClick={onCompact}
                        >
                            <Icon icon={Minimize2} size={12} /> {t('contextMeter.compact')}
                        </button>
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    );
}
