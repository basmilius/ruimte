import { createChart } from '@adecore/charts';
import { ScrollArea, useContentSize } from '@adecore/ui';
import { useTranslation } from 'react-i18next';
import type { Axis, ChartModel, ModelMark } from './chart';
import { clearOnEscape } from './clear-on-escape';
import { barGroups, formatMetric, metricValue, shortModelName, VIEW_METRICS, type BarMetric, type PointInteraction } from './comparison';
import { LabLogo } from './LabLogo';

interface ModelsBarChartProps extends PointInteraction {
    models: readonly ChartModel[];
    marks: ReadonlyMap<string, ModelMark>;
    metric: BarMetric;
    grouped: boolean;
    axis: Axis;
    highlighted: string | null;
}

interface BarRow {
    key: string;
    modelId: string;
    modelName: string;
    effort: string;
    value: number;
    color: string;
}

const BarChart = createChart<BarRow>();

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
    const [measure, size] = useContentSize();

    const metric = VIEW_METRICS[view];
    const rows: BarRow[] = barGroups(models, view, grouped)
        .flat()
        .map((point) => ({
            key: point.key,
            modelId: point.modelId,
            modelName: point.modelName,
            effort: point.effort,
            value: metricValue(point, metric)!,
            color: marks.get(point.modelId)?.color ?? 'var(--text-muted)'
        }));
    const rowOf = new Map(rows.map((row) => [row.key, row]));
    const referenceRow = reference === null ? undefined : rowOf.get(reference);
    const candidateRow = candidate === null ? undefined : rowOf.get(candidate);
    const effortName = (effort: string): string => t(`efforts.${effort}`, { defaultValue: effort });
    const shortEffort = (key: unknown): string => {
        const effort = rowOf.get(String(key))?.effort ?? '';
        return t(`shortEfforts.${effort}`, { defaultValue: effortName(effort) });
    };
    // A ranked list reads as rows with the whole name beside each bar; the groups keep their columns under a logo.
    const horizontal = !grouped;
    const rowName = (key: unknown): string => {
        const row = rowOf.get(String(key));

        return row === undefined ? '' : `${row.modelName} · ${effortName(row.effort)}`;
    };

    const chart = (
        <BarChart.Root
            data={rows}
            x="key"
            orientation={horizontal ? 'horizontal' : 'vertical'}
            rowLabel={(row) => (grouped ? effortName(row.effort) : `${row.modelName}, ${effortName(row.effort)}`)}
            group={grouped ? 'modelId' : undefined}
            groupLabel={grouped ? 'modelName' : undefined}
            groupGap={grouped ? 20 : 0}
            label={t(`views.${view}`)}
            y={{ min: axis.ticks[0], max: axis.ticks.at(-1), step: axis.ticks[1]! - axis.ticks[0]! }}
            {...(horizontal ? {} : { height: 300, grow: true })}
            margin={{ top: 44, right: 16 }}
            surface="raised"
            minBucketWidth={size.width < 600 ? 34 : 16}
            selected={[reference, candidate].filter((key) => key !== null)}
            onActivate={(row) => onActivate(row.key)}
            onActiveXChange={(x) => onPreview(x === null ? null : String(x))}
            dimmed={(row) => highlighted !== null && row.modelId !== highlighted}
        >
            <BarChart.Grid dashed />
            <BarChart.YAxis title={t(`units.${metric}`)} format={(value) => formatMetric(value, metric, true)} />
            {horizontal ? <BarChart.XAxis format={rowName} /> : <BarChart.XAxis format={shortEffort} thin={false} />}
            <BarChart.Bar
                value="value"
                label={t(`metrics.${metric}`)}
                tone={(row) => ({ color: row.color })}
                opacity={(_row, index, groupSize) => 0.6 + (index / Math.max(groupSize - 1, 1)) * 0.4}
                hoverOpacity={1}
                dimOpacity={0.3}
                columnWidth={(bucket) => Math.max(6, Math.min(horizontal ? 20 : 44, Math.floor(bucket) - (horizontal ? 12 : 4)))}
                radius={3}
                valueLabels
            />
            {referenceRow !== undefined && <BarChart.Rule value={referenceRow.value} label="A" tone={{ color: 'var(--text-muted)' }} />}
            {candidateRow !== undefined && <BarChart.Rule value={candidateRow.value} label="B" tone={{ color: 'var(--text-muted)' }} dashed />}
            {grouped && (
                <BarChart.GroupAxis>
                    {(group) => {
                        const model = models.find((entry) => entry.id === group.key)!;
                        return (
                            <span className="flex flex-col items-center gap-1 font-medium" style={{ color: marks.get(model.id)?.color }}>
                                <LabLogo lab={model.lab} size={18} />
                                <span className="px-1 leading-tight">{shortModelName(model.name)}</span>
                            </span>
                        );
                    }}
                </BarChart.GroupAxis>
            )}
        </BarChart.Root>
    );

    // Only the ranked rows outgrow the panel; the columns grow into its height instead.
    return horizontal ? (
        <ScrollArea viewportRef={measure} className="h-full" onKeyDownCapture={clearOnEscape(reference, onClear)}>
            {chart}
        </ScrollArea>
    ) : (
        <div ref={measure} className="h-full min-h-0 min-w-0" onKeyDownCapture={clearOnEscape(reference, onClear)}>
            {chart}
        </div>
    );
}
