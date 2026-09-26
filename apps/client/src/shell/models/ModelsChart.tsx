import { useId, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { BenchmarkPoint } from '@ruimte/pulsar';
import { formatDecimal, formatUsdSignificant } from '@/format/number';
import {
    boxOf,
    costAxis,
    frontier,
    intelligenceAxis,
    LABEL_HEIGHT,
    markPath,
    movePoint,
    nearestPoint,
    overlaps,
    placeLabels,
    type ChartModel,
    type CostScale,
    type ModelMark,
    type PointAt
} from '@/shell/models/chart';
import { EmptyState } from '@ruimte/ui/EmptyState';
import { useMeasuredWidth } from '@ruimte/ui/useMeasuredWidth';

interface ModelsChartProps {
    /* The models that are switched on and measured, in the order of the list beside the chart. */
    models: readonly ChartModel[];
    marks: ReadonlyMap<string, ModelMark>;
    scale: CostScale;
    /* The model the list points at; every other line steps back. */
    highlighted: string | null;
}

const HEIGHT = 400;
const PAD = { left: 40, right: 16, top: 32, bottom: 36 };
/* A line the list does not point at still has to be seen, just not read first. */
const DIMMED = 0.2;
/* How far from a point the pointer may be and still answer for it. */
const REACH = 24;
/* A text over a line stays readable when the ground is drawn around its letters first. */
const HALO = { stroke: 'var(--surface-raised)', strokeWidth: 4, strokeLinejoin: 'round', paintOrder: 'stroke' } as const;

interface Placed extends BenchmarkPoint {
    line: number;
    index: number;
    x: number;
    y: number;
}

const keyOf = (at: PointAt): string => `${at.line}:${at.index}`;

const measuring = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');

/* The width of a label before it is drawn, so the labels can be placed around each other. */
const textWidth = (text: string, weight: number): number => {
    if (measuring === null) {
        return text.length * 7;
    }
    measuring.font = `${weight} 12px ${getComputedStyle(document.body).fontFamily}`;
    return measuring.measureText(text).width;
};

/*
 * The Intelligence Index against the cost per task, a line per model through its efforts and a band
 * under the points nothing beats. The point nearest the pointer draws guides to both axes and its
 * values on them; every point also takes the focus, so the keyboard reads the same.
 */
export function ModelsChart({ models, marks, scale, highlighted }: ModelsChartProps) {
    const { t } = useTranslation('models');
    const describedBy = useId();
    const [measure, width] = useMeasuredWidth();
    const [hovered, setHovered] = useState<PointAt | null>(null);
    const [focused, setFocused] = useState<PointAt | null>(null);
    const nodes = useRef(new Map<string, SVGGElement>());

    const plotWidth = Math.max(0, width - PAD.left - PAD.right);
    const plotHeight = HEIGHT - PAD.top - PAD.bottom;
    const bottom = PAD.top + plotHeight;

    const { xAxis, yAxis, lines } = useMemo(() => {
        const all = models.flatMap((model) => model.points);
        const costs = costAxis(
            all.map((point) => point.costPerTask),
            scale
        );
        const intelligence = intelligenceAxis(all.map((point) => point.intelligence));
        const placed: Placed[][] = models.map((model, line) =>
            model.points.map((point, index) => ({
                ...point,
                line,
                index,
                x: Math.round(PAD.left + costs.at(point.costPerTask) * plotWidth),
                y: Math.round(PAD.top + (1 - intelligence.at(point.intelligence)) * plotHeight)
            }))
        );
        return { xAxis: costs, yAxis: intelligence, lines: placed };
    }, [models, scale, plotWidth, plotHeight]);
    const places = useMemo(
        () =>
            placeLabels(
                lines,
                models.map((model) => textWidth(model.name, 400)),
                { left: PAD.left, top: 4, right: width - 4, bottom }
            ),
        [lines, models, width, bottom]
    );

    const xOf = (cost: number): number => Math.round(PAD.left + xAxis.at(cost) * plotWidth);
    const yOf = (intelligence: number): number => Math.round(PAD.top + (1 - yAxis.at(intelligence)) * plotHeight);
    const band = frontier(lines.flat());
    const shown = hovered ?? focused;
    const active = shown === null ? null : (lines[shown.line]?.[shown.index] ?? null);
    const activeModel = active === null ? null : models[active.line]!;
    const activeColor = activeModel === null ? null : (marks.get(activeModel.id)?.color ?? 'var(--text-muted)');
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

    /* The name of the point that answers sits over it, or under it against the top, and never past a side. */
    const callout = (() => {
        if (active === null || activeModel === null) {
            return null;
        }
        const text = `${activeModel.name} · ${effortLabel(active.effort)}`;
        const half = textWidth(text, 500) / 2;
        const x = Math.min(Math.max(active.x, PAD.left + half), width - 4 - half);
        const y = active.y - 18 - LABEL_HEIGHT / 2 < 4 ? active.y + 20 : active.y - 18;
        return { text, x, y, box: boxOf(x, y, 'middle', half * 2) };
    })();

    const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
        const rect = e.currentTarget.getBoundingClientRect();
        const next = nearestPoint(lines, e.clientX - rect.left, e.clientY - rect.top, REACH);
        if (next?.line !== hovered?.line || next?.index !== hovered?.index) {
            setHovered(next);
        }
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

    /* The line that answers draws last, so it sits on top of the lines it crosses. */
    const order = models.map((_, line) => line).sort((one, other) => Number(one === active?.line) - Number(other === active?.line));

    return (
        <div ref={measure} className="relative select-none" style={{ height: HEIGHT }}>
            <svg
                width={width}
                height={HEIGHT}
                role="group"
                aria-label={t('chart.label')}
                aria-describedby={describedBy}
                style={{ cursor: hovered === null ? undefined : 'crosshair' }}
                onPointerMove={onPointerMove}
                onPointerLeave={() => setHovered(null)}
            >
                {yAxis.ticks.map((tick) => {
                    const y = yOf(tick) + 0.5;
                    return (
                        <g key={`y${tick}`}>
                            <line x1={PAD.left} x2={PAD.left + plotWidth} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
                            {(active === null || Math.abs(y - active.y) > LABEL_HEIGHT) && (
                                <text x={PAD.left - 8} y={y} textAnchor="end" dominantBaseline="middle" className="fill-text-faint text-xs tabular-nums">
                                    {formatDecimal(tick)}
                                </text>
                            )}
                        </g>
                    );
                })}
                {xAxis.ticks.map((tick) => {
                    const x = xOf(tick) + 0.5;
                    return (
                        <g key={`x${tick}`}>
                            <line x1={x} x2={x} y1={PAD.top} y2={bottom} stroke="var(--border-soft)" strokeWidth={1} />
                            {(active === null || Math.abs(x - active.x) > 40) && (
                                <text x={x} y={bottom + 16} textAnchor="middle" className="fill-text-faint text-xs tabular-nums">
                                    {formatUsdSignificant(tick)}
                                </text>
                            )}
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
                {active !== null && activeColor !== null && (
                    <path
                        d={`M${PAD.left} ${active.y + 0.5} H${active.x} M${active.x + 0.5} ${active.y} V${bottom}`}
                        fill="none"
                        stroke={activeColor}
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        opacity={0.8}
                    />
                )}
                {order.map((line) => {
                    const model = models[line]!;
                    const points = lines[line]!;
                    const mark = marks.get(model.id);
                    const color = mark?.color ?? 'var(--text-muted)';
                    const dimmed = highlighted !== null && highlighted !== model.id;
                    const place = places[line];
                    const labelShown = place && line !== active?.line && (callout === null || !overlaps(place.box, callout.box));
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
                                const isActive = active?.line === line && active.index === point.index;
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
                                    >
                                        {isFocused && <circle cx={point.x} cy={point.y} r={10} fill="none" stroke="var(--text)" strokeWidth={2} />}
                                        <path
                                            d={markPath(mark?.shape ?? 'circle', point.x, point.y, isActive ? 5.5 : 4)}
                                            fill={color}
                                            stroke="var(--surface-raised)"
                                            strokeWidth={1.5}
                                            strokeLinejoin="round"
                                            paintOrder="stroke"
                                        />
                                    </g>
                                );
                            })}
                            {place && labelShown && (
                                <text
                                    x={place.x}
                                    y={place.y}
                                    textAnchor={place.anchor}
                                    dominantBaseline="middle"
                                    className={clsx('text-xs', highlighted === model.id ? 'fill-text' : 'fill-text-muted')}
                                    {...HALO}
                                >
                                    {model.name}
                                </text>
                            )}
                        </g>
                    );
                })}
                {active !== null && activeColor !== null && callout !== null && (
                    <g aria-hidden fill={activeColor} className="text-xs font-medium tabular-nums" {...HALO}>
                        <text x={callout.x} y={callout.y} textAnchor="middle" dominantBaseline="middle">
                            {callout.text}
                        </text>
                        <text x={PAD.left - 8} y={active.y} textAnchor="end" dominantBaseline="middle">
                            {formatDecimal(active.intelligence)}
                        </text>
                        <text x={active.x} y={bottom + 16} textAnchor="middle">
                            {formatUsdSignificant(active.costPerTask)}
                        </text>
                    </g>
                )}
            </svg>
            <p id={describedBy} className="sr-only">
                {models.map(rangeOf).join(' ')}
            </p>
            {models.length === 0 && <EmptyState className="pointer-events-none absolute inset-0">{t('chart.nothingShown')}</EmptyState>}
        </div>
    );
}
