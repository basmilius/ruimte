import { useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { UsageProvider } from '@ruimte/contracts';
import { FLOAT } from '@ruimte/ui/classes';
import { useMeasuredWidth } from '@ruimte/ui/useMeasuredWidth';
import { PROVIDER_COLORS, PROVIDER_LABELS, slotAxisLabel, slotLabel } from '@ruimte/agents-react/usage/format';
import { niceScale, type ChartSlot } from '@/shell/usage/summary';

interface UsageChartProps {
    slots: readonly ChartSlot[];
    providers: readonly UsageProvider[];
    format(value: number): string;
    /* Which x labels to draw, every nth slot, so 24 hours and 90 days both stay readable. */
    labelEvery: number;
}

const HEIGHT = 224;
const TOOLTIP_WIDTH = 168;
/* A bar that is dimmed still has to read as its own color, so the rest keeps well over half of it. */
const DIMMED = 0.55;

/*
 * One stacked bar per slot, a segment per provider. Stacked rather than layered areas, since the total
 * of a day is the height of its bar, and the smaller provider never disappears under the larger one.
 */
export function UsageChart({ slots, providers, format, labelEvery }: UsageChartProps) {
    const { t } = useTranslation('usage');
    const [measure, width] = useMeasuredWidth();
    const [hovered, setHovered] = useState<number | null>(null);
    const scale = niceScale(Math.max(...slots.map((slot) => slot.total), 0));
    const band = slots.length === 0 ? 0 : width / slots.length;
    const barWidth = Math.max(1, Math.round(band * 0.62));
    const ticks = Array.from({ length: Math.round(scale.max / scale.step) + 1 }, (_, index) => index * scale.step);
    const active = hovered === null ? null : slots[hovered];

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
        const bounds = e.currentTarget.getBoundingClientRect();
        const index = band === 0 ? -1 : Math.floor((e.clientX - bounds.left) / band);
        setHovered(index >= 0 && index < slots.length ? index : null);
    };

    /* Near the right edge the card would run off the column, so it hangs from the other side. */
    const tooltipLeft =
        hovered === null ? 0 : Math.round(Math.min(Math.max(0, hovered * band + band / 2 - TOOLTIP_WIDTH / 2), Math.max(0, width - TOOLTIP_WIDTH)));

    return (
        <div className="flex flex-col">
            <div ref={measure} className="relative" style={{ height: HEIGHT }} onPointerMove={onPointerMove} onPointerLeave={() => setHovered(null)}>
                <svg width={width} height={HEIGHT} role="presentation">
                    {ticks.map((tick) => {
                        const y = Math.round(HEIGHT - (tick / scale.max) * HEIGHT) + 0.5;
                        return <line key={tick} x1={0} x2={width} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />;
                    })}
                    {slots.map((slot, index) => {
                        const left = Math.round(index * band + (band - barWidth) / 2);
                        let bottom = HEIGHT;
                        return (
                            <g key={slot.slot} opacity={hovered === null || hovered === index ? 1 : DIMMED}>
                                {providers.map((provider) => {
                                    const value = slot.byProvider[provider] ?? 0;
                                    if (value <= 0) {
                                        return null;
                                    }
                                    const height = Math.max(1, Math.round((value / scale.max) * HEIGHT));
                                    bottom -= height;
                                    return <rect key={provider} x={left} y={bottom} width={barWidth} height={height} fill={PROVIDER_COLORS[provider]} />;
                                })}
                            </g>
                        );
                    })}
                    {hovered !== null && (
                        <line
                            x1={Math.round(hovered * band + band / 2) + 0.5}
                            x2={Math.round(hovered * band + band / 2) + 0.5}
                            y1={0}
                            y2={HEIGHT}
                            stroke="var(--border-strong)"
                            strokeWidth={1}
                        />
                    )}
                </svg>
                {active && (
                    <div
                        className={clsx(FLOAT, 'pointer-events-none absolute top-2 rounded-lg p-2 text-xs')}
                        style={{ left: tooltipLeft, width: TOOLTIP_WIDTH }}
                    >
                        <p className="mb-1 font-medium">{slotLabel(active.slot)}</p>
                        {providers.map((provider) => (
                            <p key={provider} className="flex items-center gap-1.5 text-text-muted">
                                <span className="size-2 shrink-0 rounded-full" style={{ background: PROVIDER_COLORS[provider] }} />
                                {PROVIDER_LABELS[provider]}
                                <span className="ml-auto tabular-nums text-text">{format(active.byProvider[provider] ?? 0)}</span>
                            </p>
                        ))}
                        <p className="mt-1 flex items-center gap-1.5 border-t border-border pt-1 font-medium">
                            {t('chart.total')}
                            <span className="ml-auto tabular-nums">{format(active.total)}</span>
                        </p>
                    </div>
                )}
            </div>
            <div className="relative mt-2 h-4">
                {slots.map((slot, index) =>
                    index % labelEvery === 0 ? (
                        <span
                            key={slot.slot}
                            className="absolute -translate-x-1/2 text-xs whitespace-nowrap text-text-faint"
                            style={{ left: Math.round(index * band + band / 2) }}
                        >
                            {slotAxisLabel(slot.slot)}
                        </span>
                    ) : null
                )}
            </div>
        </div>
    );
}
