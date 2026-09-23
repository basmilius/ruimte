import { useId, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { BenchmarkPoint } from '@ruimte/pulsar';
import { formatDecimal, formatUsdSignificant } from '@/format/number';
import { costAxis, frontier, intelligenceAxis, movePoint, spreadLabels, type ChartModel, type CostScale, type PointAt } from '@/shell/models/chart';
import { EmptyState } from '@/ui/EmptyState';
import { FLOAT } from '@/ui/classes';
import { ProviderLogo } from '@/ui/ProviderLogo';
import { useMeasuredWidth } from '@/ui/useMeasuredWidth';

interface ModelsChartProps {
    /* The models that are switched on and measured, in the order of the list beside the chart. */
    models: readonly ChartModel[];
    colors: ReadonlyMap<string, string>;
    scale: CostScale;
    /* The model the list points at; every other line steps back. */
    highlighted: string | null;
}

const HEIGHT = 400;
const PAD = { left: 40, right: 136, top: 32, bottom: 36 };
const CARD_WIDTH = 216;
const LABEL_GAP = 16;
/* A line the list does not point at still has to be seen, just not read first. */
const DIMMED = 0.2;

interface Placed extends BenchmarkPoint {
    line: number;
    index: number;
    x: number;
    y: number;
}

const keyOf = (at: PointAt): string => `${at.line}:${at.index}`;

/*
 * The Intelligence Index against the cost per task, a line per model through its efforts and a band
 * under the points nothing beats. Drawn in real pixels, like the usage chart. Every point takes the
 * focus, so the card that answers a pointer answers the keyboard too.
 */
export function ModelsChart({ models, colors, scale, highlighted }: ModelsChartProps) {
    const { t } = useTranslation('models');
    const describedBy = useId();
    const [measure, width] = useMeasuredWidth();
    const [hovered, setHovered] = useState<PointAt | null>(null);
    const [focused, setFocused] = useState<PointAt | null>(null);
    const nodes = useRef(new Map<string, SVGGElement>());

    const all = useMemo(() => models.flatMap((model) => model.points), [models]);
    const xAxis = costAxis(
        all.map((point) => point.costPerTask),
        scale
    );
    const yAxis = intelligenceAxis(all.map((point) => point.intelligence));
    const plotWidth = Math.max(0, width - PAD.left - PAD.right);
    const plotHeight = HEIGHT - PAD.top - PAD.bottom;
    const xOf = (cost: number): number => Math.round(PAD.left + xAxis.at(cost) * plotWidth);
    const yOf = (intelligence: number): number => Math.round(PAD.top + (1 - yAxis.at(intelligence)) * plotHeight);

    const lines: Placed[][] = models.map((model, line) =>
        model.points.map((point, index) => ({ ...point, line, index, x: xOf(point.costPerTask), y: yOf(point.intelligence) }))
    );
    const band = frontier(lines.flat());
    const labelYs = spreadLabels(
        lines.map((points) => points.at(-1)?.y ?? 0),
        LABEL_GAP,
        PAD.top,
        PAD.top + plotHeight
    );
    const shown = hovered ?? focused;
    const active = shown === null ? null : (lines[shown.line]?.[shown.index] ?? null);
    const activeModel = active === null ? null : models[active.line]!;
    const tabbable = focused !== null && lines[focused.line]?.[focused.index] ? focused : { line: 0, index: 0 };

    const effortLabel = (effort: string): string => t(`efforts.${effort}`, { defaultValue: effort });
    const pointLabel = (model: ChartModel, point: BenchmarkPoint): string =>
        t('chart.point', {
            model: model.name,
            effort: effortLabel(point.effort),
            intelligence: formatDecimal(point.intelligence),
            cost: formatUsdSignificant(point.costPerTask)
        });
    const rangeOf = (model: ChartModel): string => {
        const first = model.points[0]!;
        const last = model.points.at(-1)!;
        return model.points.length === 1
            ? t('chart.single', { model: model.name, intelligence: formatDecimal(first.intelligence), cost: formatUsdSignificant(first.costPerTask) })
            : t('chart.range', {
                  model: model.name,
                  fromIntelligence: formatDecimal(first.intelligence),
                  fromCost: formatUsdSignificant(first.costPerTask),
                  toIntelligence: formatDecimal(last.intelligence),
                  toCost: formatUsdSignificant(last.costPerTask)
              });
    };

    const onKeyDown = (e: React.KeyboardEvent<SVGGElement>, at: PointAt): void => {
        const next = movePoint(
            lines.map((points) => points.length),
            at,
            e.key
        );
        if (next === null) {
            return;
        }
        e.preventDefault();
        nodes.current.get(keyOf(next))?.focus();
    };

    /* Beside the point, on the side with room, and never past the top or the bottom of the plot. */
    const cardLeft = active === null ? 0 : active.x + 14 + CARD_WIDTH > width ? active.x - 14 - CARD_WIDTH : active.x + 14;
    const cardTop = active === null ? 0 : Math.min(Math.max(0, active.y - 40), HEIGHT - 104);

    return (
        <div ref={measure} className="relative select-none" style={{ height: HEIGHT }}>
            <svg width={width} height={HEIGHT} role="group" aria-label={t('chart.label')} aria-describedby={describedBy}>
                {yAxis.ticks.map((tick) => {
                    const y = yOf(tick) + 0.5;
                    return (
                        <g key={`y${tick}`}>
                            <line x1={PAD.left} x2={PAD.left + plotWidth} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
                            <text x={PAD.left - 8} y={y} textAnchor="end" dominantBaseline="middle" className="fill-text-faint text-xs tabular-nums">
                                {formatDecimal(tick)}
                            </text>
                        </g>
                    );
                })}
                {xAxis.ticks.map((tick) => {
                    const x = xOf(tick) + 0.5;
                    return (
                        <g key={`x${tick}`}>
                            <line x1={x} x2={x} y1={PAD.top} y2={PAD.top + plotHeight} stroke="var(--border-soft)" strokeWidth={1} />
                            <text x={x} y={PAD.top + plotHeight + 16} textAnchor="middle" className="fill-text-faint text-xs tabular-nums">
                                {formatUsdSignificant(tick)}
                            </text>
                        </g>
                    );
                })}
                <text x={PAD.left} y={12} className="fill-text-muted text-xs">
                    {t('chart.intelligence')}
                </text>
                <text x={PAD.left + plotWidth / 2} y={HEIGHT - 2} textAnchor="middle" className="fill-text-muted text-xs">
                    {scale === 'log' ? t('chart.costLog') : t('chart.cost')}
                </text>
                {band.length > 1 && (
                    <polyline
                        points={band.map((point) => `${point.x},${point.y}`).join(' ')}
                        fill="none"
                        stroke="var(--chart-frontier)"
                        strokeWidth={14}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                )}
                {models.map((model, line) => {
                    const points = lines[line]!;
                    const color = colors.get(model.id) ?? 'var(--text-muted)';
                    const dimmed = highlighted !== null && highlighted !== model.id;
                    const last = points.at(-1);
                    return (
                        <g key={model.id} opacity={dimmed ? DIMMED : 1}>
                            {points.length > 1 && (
                                <polyline
                                    points={points.map((point) => `${point.x},${point.y}`).join(' ')}
                                    fill="none"
                                    stroke={color}
                                    strokeWidth={2}
                                    strokeLinejoin="round"
                                />
                            )}
                            {points.map((point) => {
                                const at = { line, index: point.index };
                                const isTabbable = tabbable.line === line && tabbable.index === point.index;
                                const isFocused = focused?.line === line && focused.index === point.index;
                                return (
                                    <g
                                        key={point.effort}
                                        ref={(node) => {
                                            if (node) {
                                                nodes.current.set(keyOf(at), node);
                                            } else {
                                                nodes.current.delete(keyOf(at));
                                            }
                                        }}
                                        role="img"
                                        aria-label={pointLabel(model, point)}
                                        tabIndex={isTabbable ? 0 : -1}
                                        className="outline-none"
                                        onFocus={() => setFocused(at)}
                                        onBlur={() => setFocused(null)}
                                        onKeyDown={(e) => onKeyDown(e, at)}
                                        onPointerEnter={() => setHovered(at)}
                                        onPointerLeave={() => setHovered(null)}
                                    >
                                        <circle cx={point.x} cy={point.y} r={10} fill="transparent" />
                                        {isFocused && <circle cx={point.x} cy={point.y} r={7} fill="none" stroke="var(--text)" strokeWidth={2} />}
                                        <circle cx={point.x} cy={point.y} r={4} fill={color} stroke="var(--surface-raised)" strokeWidth={2} />
                                    </g>
                                );
                            })}
                            {last && (
                                <text
                                    x={last.x + 10}
                                    y={labelYs[line]}
                                    dominantBaseline="middle"
                                    className={clsx('text-xs', highlighted === model.id ? 'fill-text' : 'fill-text-muted')}
                                >
                                    {model.name}
                                </text>
                            )}
                        </g>
                    );
                })}
            </svg>
            <p id={describedBy} className="sr-only">
                {models.map(rangeOf).join(' ')}
            </p>
            {models.length === 0 && <EmptyState className="pointer-events-none absolute inset-0">{t('chart.nothingShown')}</EmptyState>}
            {active !== null && activeModel !== null && (
                <div
                    aria-hidden
                    className={clsx(FLOAT, 'pointer-events-none absolute rounded-lg p-2 text-xs')}
                    style={{ left: cardLeft, top: cardTop, width: CARD_WIDTH }}
                >
                    <p className="flex items-center gap-1.5 font-medium text-text">
                        <ProviderLogo provider={activeModel.provider} size={12} className="text-text-muted" />
                        <span className="min-w-0 truncate">{activeModel.name}</span>
                    </p>
                    <p className="mb-1 text-text-muted">{effortLabel(active.effort)}</p>
                    <p className="flex items-center gap-1.5 text-text-muted">
                        {t('card.intelligence')}
                        <span className="ml-auto tabular-nums text-text">{formatDecimal(active.intelligence)}</span>
                    </p>
                    <p className="flex items-center gap-1.5 text-text-muted">
                        {t('card.cost')}
                        <span className="ml-auto tabular-nums text-text">{formatUsdSignificant(active.costPerTask)}</span>
                    </p>
                </div>
            )}
        </div>
    );
}
