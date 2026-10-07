import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useContentSize } from '@adecore/ui';
import { ProviderLogo } from '@adecore/agents-react/agents/ProviderLogo';
import type { Axis, ChartModel, ModelMark } from './chart';
import { barGroups, formatMetric, metricValue, shortModelName, VIEW_METRICS, type BarMetric, type PointInteraction } from './comparison';
import { usePointNavigation } from './use-point-navigation';

interface ModelsBarChartProps extends PointInteraction {
    models: readonly ChartModel[];
    marks: ReadonlyMap<string, ModelMark>;
    metric: BarMetric;
    grouped: boolean;
    axis: Axis;
    highlighted: string | null;
}

const LEFT = 58;
const TOP = 44;
const RIGHT = 16;
const LABEL_HEIGHT = 16;

export function ModelsBarChart({
    models,
    marks,
    metric: view,
    grouped,
    axis,
    highlighted,
    reference,
    candidate,
    onActivate,
    onPreview,
    onClear
}: ModelsBarChartProps) {
    const { t } = useTranslation('models');
    const description = useId();
    const [measure, size] = useContentSize();
    const [hovered, setHovered] = useState<string | null>(null);
    const groups = barGroups(models, view, grouped);
    const { root: rootRef, nodes, focused, tabbable, focus, blur, navigate } = usePointNavigation(groups.map((group) => group.map((point) => point.key)));
    const preview = hovered ?? focused;
    const points = groups.flat();
    const metric = VIEW_METRICS[view];
    const height = Math.max(300, size.height);
    const bottom = height - (grouped ? 96 : 132);
    const minimumSlot = size.width < 600 ? 34 : 16;
    const gap = grouped ? 20 : 0;
    const width = Math.max(size.width, LEFT + RIGHT + points.length * minimumSlot + groups.length * gap);
    const plotWidth = width - LEFT - RIGHT;
    const slot = (plotWidth - groups.length * gap) / Math.max(points.length, 1);
    const barWidth = Math.max(6, Math.min(44, Math.floor(slot) - 4));
    const yOf = (value: number): number => Math.round(bottom - axis.at(value) * (bottom - TOP));
    const labelBoxes: { left: number; right: number; top: number; bottom: number }[] = [];
    const placed = groups.map((group, groupIndex) => {
        const offset = groups.slice(0, groupIndex).reduce((count, entries) => count + entries.length, 0);
        const left = LEFT + offset * slot + groupIndex * gap + gap / 2;
        return {
            model: models.find((model) => model.id === group[0]!.modelId)!,
            center: Math.round(left + (group.length * slot) / 2),
            width: group.length * slot + gap,
            points: group.map((point, index) => {
                const x = Math.round(left + (index + 0.5) * slot);
                const y = yOf(metricValue(point, metric)!);
                const label = formatMetric(metricValue(point, metric)!, metric, true);
                const half = label.length * 4;
                let labelY = y - 10;
                // Values close to the baseline need separate label rows, even when the bars fit side by side.
                while (
                    labelBoxes.some((box) => box.left < x + half + 3 && box.right > x - half - 3 && box.top < labelY + 3 && box.bottom > labelY - LABEL_HEIGHT)
                ) {
                    labelY -= LABEL_HEIGHT;
                }
                labelBoxes.push({ left: x - half, right: x + half, top: labelY - LABEL_HEIGHT, bottom: labelY + 3 });
                return { ...point, x, y, label, labelY };
            })
        };
    });
    const flat = placed.flatMap((group) => group.points);
    const referencePoint = flat.find((point) => point.key === reference);
    const candidatePoint = flat.find((point) => point.key === candidate);

    useEffect(() => {
        onPreview(preview);
        return () => onPreview(null);
    }, [preview, onPreview]);

    return (
        <div ref={measure} className="h-full min-h-0 min-w-0">
            <div ref={rootRef} tabIndex={-1} onBlur={blur} className="h-full overflow-x-auto overflow-y-hidden overscroll-x-contain outline-none">
                <svg
                    width={width}
                    height={height}
                    role="group"
                    aria-label={t(`views.${view}`)}
                    aria-describedby={description}
                    onPointerLeave={() => setHovered(null)}
                >
                    <text x={LEFT} y={16} className="fill-text-muted text-xs">
                        {t(`units.${metric}`)}
                    </text>
                    {axis.ticks.map((tick) => (
                        <g key={tick}>
                            <line
                                x1={LEFT}
                                x2={width - RIGHT}
                                y1={yOf(tick)}
                                y2={yOf(tick)}
                                stroke="var(--border)"
                                strokeDasharray={tick === 0 ? undefined : '2 5'}
                            />
                            <text x={LEFT - 10} y={yOf(tick)} dominantBaseline="middle" textAnchor="end" className="fill-text-faint text-xs tabular-nums">
                                {formatMetric(tick, metric, true)}
                            </text>
                        </g>
                    ))}
                    {flat
                        .filter((point) => point.key === preview || point.key === reference)
                        .map((point) => (
                            <rect key={point.key} x={point.x - slot / 2} y={TOP} width={slot} height={bottom - TOP} fill="var(--surface-hover)" />
                        ))}
                    {placed.map((group) => (
                        <g key={grouped ? group.model.id : 'ranked'}>
                            {group.points.map((point, index) => {
                                const pinned = point.key === reference || point.key === candidate;
                                const active = point.key === preview || pinned;
                                const color = marks.get(point.modelId)?.color ?? 'var(--text-muted)';
                                const dimmed = (reference !== null && !active) || (highlighted !== null && highlighted !== point.modelId);
                                const effort = t(`efforts.${point.effort}`, { defaultValue: point.effort });
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
                                        aria-label={t('bars.point', {
                                            model: point.modelName,
                                            effort,
                                            metric: t(`metrics.${metric}`),
                                            value: formatMetric(metricValue(point, metric)!, metric)
                                        })}
                                        aria-pressed={pinned}
                                        aria-description={
                                            point.key === reference ? t('compare.reference') : point.key === candidate ? t('compare.candidate') : undefined
                                        }
                                        tabIndex={tabbable === point.key ? 0 : -1}
                                        className="cursor-pointer outline-none"
                                        opacity={dimmed ? 0.3 : 1}
                                        onPointerMove={() => setHovered(point.key)}
                                        onPointerLeave={() => setHovered(null)}
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
                                        <rect x={point.x - slot / 2} y={TOP} width={slot} height={bottom - TOP + 24} fill="transparent" />
                                        <rect
                                            x={point.x - barWidth / 2}
                                            y={point.y}
                                            width={barWidth}
                                            height={Math.max(2, bottom - point.y)}
                                            rx={3}
                                            fill={color}
                                            opacity={active ? 1 : 0.6 + (index / Math.max(group.points.length - 1, 1)) * 0.4}
                                        />
                                        {focused === point.key && (
                                            <rect
                                                x={point.x - barWidth / 2 - 2}
                                                y={point.y - 2}
                                                width={barWidth + 4}
                                                height={Math.max(2, bottom - point.y) + 4}
                                                rx={4}
                                                fill="none"
                                                stroke="var(--text)"
                                                strokeWidth={2}
                                            />
                                        )}
                                        <text x={point.x} y={bottom + 17} textAnchor="middle" className="fill-text-faint text-xs">
                                            {t(`shortEfforts.${point.effort}`, { defaultValue: effort })}
                                        </text>
                                        {!grouped && (
                                            <text
                                                transform={`translate(${point.x},${bottom + 31}) rotate(-40)`}
                                                textAnchor="end"
                                                className="fill-text-muted text-xs"
                                            >
                                                {shortModelName(point.modelName)}
                                            </text>
                                        )}
                                    </g>
                                );
                            })}
                            {grouped && (
                                <foreignObject x={group.center - group.width / 2} y={bottom + 28} width={group.width} height={68}>
                                    <div
                                        className="flex flex-col items-center gap-1 text-center text-xs font-medium"
                                        style={{ color: marks.get(group.model.id)?.color }}
                                    >
                                        <ProviderLogo provider={group.model.provider} size={18} />
                                        <span className="px-1 leading-tight">{shortModelName(group.model.name)}</span>
                                    </div>
                                </foreignObject>
                            )}
                        </g>
                    ))}
                    {flat.map((point) => {
                        const active = point.key === preview || point.key === reference || point.key === candidate;
                        const dimmed = (reference !== null && !active) || (highlighted !== null && highlighted !== point.modelId);
                        return (
                            <g key={point.key} className="pointer-events-none" opacity={dimmed ? 0.3 : 1}>
                                {point.labelY < point.y - 12 && (
                                    <line x1={point.x} x2={point.x} y1={point.y - 4} y2={point.labelY + 4} stroke="var(--border-strong)" />
                                )}
                                <text
                                    x={point.x}
                                    y={point.labelY}
                                    textAnchor="middle"
                                    className="fill-text text-2xs tabular-nums"
                                    stroke="var(--surface-raised)"
                                    strokeWidth={3}
                                    paintOrder="stroke"
                                >
                                    {point.label}
                                </text>
                            </g>
                        );
                    })}
                    {[referencePoint, candidatePoint].map(
                        (point, index) =>
                            point && (
                                <g key={index} className="pointer-events-none">
                                    <line
                                        x1={LEFT}
                                        x2={width - RIGHT}
                                        y1={point.y}
                                        y2={point.y}
                                        stroke="var(--text-muted)"
                                        strokeDasharray={index === 0 ? undefined : '4 4'}
                                    />
                                    <text
                                        x={width - RIGHT}
                                        y={point.y - 7}
                                        textAnchor="end"
                                        className="fill-text text-xs font-medium"
                                        stroke="var(--surface-raised)"
                                        strokeWidth={4}
                                        paintOrder="stroke"
                                    >
                                        {index === 0 ? 'A' : 'B'} · {formatMetric(metricValue(point, metric)!, metric)}
                                    </text>
                                </g>
                            )
                    )}
                </svg>
                <p id={description} className="sr-only">
                    {t('chart.keyboard')}
                </p>
            </div>
        </div>
    );
}
