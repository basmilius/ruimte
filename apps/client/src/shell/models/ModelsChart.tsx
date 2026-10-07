import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useContentSize } from '@adecore/ui';
import { formatDecimal } from '@adecore/ui/format';
import { ProviderLogo } from '@adecore/agents-react/agents/ProviderLogo';
import { costAxis, frontier, intelligenceAxis, nearestPoint, type ChartModel, type CostScale, type ModelMark } from './chart';
import { effortSegments, formatMetric, metricValue, pointKey, shortModelName, type PointInteraction } from './comparison';
import { usePointNavigation } from './use-point-navigation';

interface ModelsChartProps extends PointInteraction {
    models: readonly ChartModel[];
    originals: readonly ChartModel[];
    marks: ReadonlyMap<string, ModelMark>;
    scale: CostScale;
    axisMetric: 'costPerTask' | 'outputSpeed';
    showFrontier: boolean;
    highlighted: string | null;
}

const LEFT = 46;
const TOP = 34;
const HALO = { stroke: 'var(--surface-raised)', strokeWidth: 4, strokeLinejoin: 'round', paintOrder: 'stroke' } as const;

export function ModelsChart({
    models,
    originals,
    marks,
    scale,
    axisMetric,
    showFrontier,
    highlighted,
    reference,
    candidate,
    onActivate,
    onPreview,
    onClear
}: ModelsChartProps) {
    const { t } = useTranslation('models');
    const description = useId();
    const [measure, size] = useContentSize();
    const [hovered, setHovered] = useState<string | null>(null);
    const width = size.width;
    const compact = width < 600;
    const height = Math.max(260, size.height);
    const labelWidth = width > 750 ? 156 : 118;
    const plotWidth = Math.max(1, width - LEFT - labelWidth - 18);
    const bottom = height - 44;
    const measured = models
        .map((model) => ({
            ...model,
            points: model.points.flatMap((point) => {
                const score = metricValue(point, 'intelligence');
                const value = metricValue(point, axisMetric);
                return score === null || value === null || (scale === 'log' && value <= 0)
                    ? []
                    : [{ ...point, score, value, key: pointKey(model.id, point.effort) }];
            })
        }))
        .filter((model) => model.points.length > 0);
    const xAxis = costAxis(
        measured.flatMap((model) => model.points.map((point) => point.value)),
        scale
    );
    const yAxis = intelligenceAxis(measured.flatMap((model) => model.points.map((point) => point.score)));
    const xOf = (value: number): number => Math.round(LEFT + xAxis.at(value) * plotWidth);
    const yOf = (score: number): number => Math.round(TOP + (1 - yAxis.at(score)) * (bottom - TOP));
    const tickIntervals = Math.max(1, Math.min(xAxis.ticks.length - 1, Math.floor(plotWidth / 70)));
    const xTicks = compact
        ? Array.from({ length: tickIntervals + 1 }, (_, index) => xAxis.ticks[Math.round((index * (xAxis.ticks.length - 1)) / tickIntervals)]!)
        : xAxis.ticks;
    const lines = measured.map((model) => model.points.map((point) => ({ ...point, x: xOf(point.value), y: yOf(point.score) })));
    const { root: rootRef, nodes, focused, tabbable, focus, blur, navigate } = usePointNavigation(lines.map((line) => line.map((point) => point.key)));
    const preview = hovered ?? focused;
    const active = lines.flat().find((point) => point.key === preview);
    const band = frontier(
        lines.flat().map((point) => ({ costPerTask: axisMetric === 'outputSpeed' ? -point.value : point.value, intelligence: point.score, point }))
    ).map((entry) => entry.point);
    const labels = lines.map((line, index) => ({ index, point: line.at(-1)!, y: line.at(-1)!.y })).sort((one, other) => one.y - other.y);
    for (let index = 0; index < labels.length; index++) {
        labels[index]!.y = Math.max(TOP, labels[index]!.y, index === 0 ? TOP : labels[index - 1]!.y + 24);
    }
    for (let index = labels.length - 1; index >= 0; index--) {
        labels[index]!.y = Math.min(labels[index]!.y, index === labels.length - 1 ? bottom - 8 : labels[index + 1]!.y - 24);
    }

    useEffect(() => {
        onPreview(preview);
        return () => onPreview(null);
    }, [preview, onPreview]);

    return (
        <div ref={measure} className="h-full min-h-0 min-w-0">
            <div ref={rootRef} tabIndex={-1} onBlur={blur} className="h-full outline-none">
                <svg
                    width={width}
                    height={height}
                    role="group"
                    aria-label={t(axisMetric === 'costPerTask' ? 'views.comparison' : 'views.speed')}
                    aria-describedby={description}
                    onPointerMove={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const nearest = nearestPoint(lines, e.clientX - rect.left, e.clientY - rect.top, 16);
                        setHovered(nearest === null ? null : lines[nearest.line]![nearest.index]!.key);
                    }}
                    onPointerLeave={() => setHovered(null)}
                >
                    <text x={LEFT} y={15} className="fill-text-muted text-xs">
                        {t('metrics.intelligence')}
                    </text>
                    {yAxis.ticks.map((tick) => (
                        <g key={tick}>
                            <line x1={LEFT} x2={LEFT + plotWidth} y1={yOf(tick)} y2={yOf(tick)} stroke="var(--border)" strokeDasharray="2 5" />
                            <text x={LEFT - 12} y={yOf(tick)} dominantBaseline="middle" textAnchor="end" className="fill-text-faint text-xs tabular-nums">
                                {formatDecimal(tick)}
                            </text>
                        </g>
                    ))}
                    <line x1={LEFT} x2={LEFT + plotWidth} y1={bottom} y2={bottom} stroke="var(--border-strong)" />
                    {xTicks.map((tick) => (
                        <g key={tick}>
                            <line x1={xOf(tick)} x2={xOf(tick)} y1={bottom} y2={bottom + 5} stroke="var(--border-strong)" />
                            <text x={xOf(tick)} y={bottom + 20} textAnchor="middle" className="fill-text-faint text-xs tabular-nums">
                                {formatMetric(tick, axisMetric, true)}
                            </text>
                        </g>
                    ))}
                    <text x={width / 2} y={height - 3} textAnchor="middle" className="fill-text-muted text-xs">
                        {t(`${compact ? 'metrics' : 'axes'}.${axisMetric}`)}
                        {scale === 'log' ? ` · ${t(compact ? 'dialog.scales.log' : 'chart.logarithmic')}` : ''}
                    </text>
                    {showFrontier && band.length > 1 && (
                        <polyline
                            points={band.map((point) => `${point.x},${point.y}`).join(' ')}
                            fill="none"
                            stroke="var(--chart-frontier)"
                            strokeWidth={14}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    )}
                    {measured.map((model, index) => {
                        const points = lines[index]!;
                        const color = marks.get(model.id)?.color ?? 'var(--text-muted)';
                        const involved = points.some((point) => point.key === reference || point.key === candidate || point.key === preview);
                        const dimmed = (highlighted !== null && highlighted !== model.id) || (reference !== null && !involved);
                        const label = labels.find((entry) => entry.index === index)!;
                        return (
                            <g key={model.id} opacity={dimmed ? 0.25 : 1}>
                                {effortSegments(points, originals.find((original) => original.id === model.id)?.points ?? [])
                                    .filter((segment) => segment.length > 1)
                                    .map((segment) => (
                                        <polyline
                                            key={segment[0]!.key}
                                            points={segment.map((point) => `${point.x},${point.y}`).join(' ')}
                                            fill="none"
                                            stroke={color}
                                            strokeWidth={2}
                                            strokeLinejoin="round"
                                        />
                                    ))}
                                {points.map((point) => {
                                    const pinned = point.key === reference || point.key === candidate;
                                    return (
                                        <g
                                            key={point.key}
                                            ref={(node) => {
                                                if (node) {
                                                    nodes.current.set(point.key, node);
                                                } else {
                                                    nodes.current.delete(point.key);
                                                }
                                            }}
                                            role="button"
                                            aria-label={t('chart.point', {
                                                model: model.name,
                                                effort: t(`efforts.${point.effort}`, { defaultValue: point.effort }),
                                                intelligence: formatDecimal(point.score),
                                                metric: t(`metrics.${axisMetric}`),
                                                value: formatMetric(point.value, axisMetric)
                                            })}
                                            aria-pressed={pinned}
                                            aria-description={
                                                point.key === reference ? t('compare.reference') : point.key === candidate ? t('compare.candidate') : undefined
                                            }
                                            tabIndex={tabbable === point.key ? 0 : -1}
                                            className="cursor-pointer outline-none"
                                            onFocus={() => focus(point.key)}
                                            onClick={() => onActivate(point.key)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    onActivate(point.key);
                                                } else if (e.key === 'Escape' && reference !== null) {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    onClear();
                                                } else {
                                                    navigate(e, point.key);
                                                }
                                            }}
                                        >
                                            <circle cx={point.x} cy={point.y} r={10} fill="transparent" />
                                            <circle
                                                cx={point.x}
                                                cy={point.y}
                                                r={point.key === preview || pinned ? 5 : 4}
                                                fill={color}
                                                stroke="var(--surface-raised)"
                                                strokeWidth={1}
                                            />
                                            {(focused === point.key || pinned) && (
                                                <circle cx={point.x} cy={point.y} r={8} fill="none" stroke="var(--text)" strokeWidth={2} />
                                            )}
                                        </g>
                                    );
                                })}
                                <line x1={label.point.x + 7} y1={label.point.y} x2={LEFT + plotWidth + 12} y2={label.y} stroke={color} opacity={0.3} />
                                <foreignObject x={LEFT + plotWidth + 18} y={label.y - 12} width={labelWidth - 22} height={24}>
                                    <div className="flex h-full items-center gap-2 text-xs font-medium" style={{ color }}>
                                        <ProviderLogo provider={model.provider} size={15} />
                                        <span className="truncate">
                                            {compact ? shortModelName(model.name).replace(/^GPT-/, '') : shortModelName(model.name)}
                                        </span>
                                    </div>
                                </foreignObject>
                            </g>
                        );
                    })}
                    {lines
                        .flat()
                        .filter((point) => point === active || point.key === reference)
                        .map((point) => (
                            <g key={point.key} className="pointer-events-none">
                                <path d={`M${LEFT} ${point.y} H${point.x} V${bottom}`} fill="none" stroke="var(--text-muted)" strokeDasharray="4 4" />
                                <text x={point.x} y={bottom + 20} textAnchor="middle" className="fill-text text-xs tabular-nums" {...HALO}>
                                    {formatMetric(point.value, axisMetric)}
                                </text>
                                <text x={LEFT - 10} y={point.y} dominantBaseline="middle" textAnchor="end" className="fill-text text-xs tabular-nums" {...HALO}>
                                    {formatDecimal(point.score)}
                                </text>
                            </g>
                        ))}
                </svg>
                <p id={description} className="sr-only">
                    {t('chart.keyboard')}
                </p>
            </div>
        </div>
    );
}
