import { createChart } from '@adecore/charts';
import { useContentSize } from '@adecore/ui';
import { formatDecimal } from '@adecore/ui/format';
import { useTranslation } from 'react-i18next';
import { costAxis, type ChartModel, type CostScale, type ModelMark } from './chart';
import { clearOnEscape } from './clear-on-escape';
import {
    effortSegments,
    formatMetric,
    lowerIsBetter,
    matchesChart,
    metricValue,
    pointKey,
    shortModelName,
    type PointInteraction,
    type ScatterMetric
} from './comparison';
import { LabLogo } from './LabLogo';

interface ModelsChartProps extends PointInteraction {
    models: readonly ChartModel[];
    originals: readonly ChartModel[];
    marks: ReadonlyMap<string, ModelMark>;
    scale: CostScale;
    axisMetric: ScatterMetric;
    showFrontier: boolean;
    highlighted: string | null;
}

/* A row without a value or a score is a gap, which breaks the line of its model. */
interface PointRow {
    key: string;
    modelId: string;
    effort: string;
    value: number | null;
    score: number | null;
    color: string;
}

const PointChart = createChart<PointRow>();

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
    const [measure, size] = useContentSize();
    const compact = size.width < 600;
    const rows: PointRow[] = models.flatMap((model) => {
        const color = marks.get(model.id)?.color ?? 'var(--text-muted)';
        const measured = model.points.flatMap((point) => {
            const score = metricValue(point, 'intelligence');
            const value = metricValue(point, axisMetric);
            return score === null || value === null || !matchesChart(point, axisMetric, true, scale)
                ? []
                : [{ ...point, key: pointKey(model.id, point.effort), modelId: model.id, value, score, color }];
        });
        const original = originals.find((entry) => entry.id === model.id)?.points ?? [];
        return effortSegments(measured, original).flatMap((segment, index) => [
            ...(index === 0 ? [] : [{ key: `${model.id}:gap:${index}`, modelId: model.id, effort: '', value: null, score: null, color }]),
            ...segment.map((point) => ({ key: point.key, modelId: model.id, effort: point.effort, value: point.value, score: point.score, color }))
        ]);
    });
    const involved = new Set(rows.filter((row) => row.key === reference || row.key === candidate).map((row) => row.modelId));
    const linear = costAxis(rows.flatMap((row) => (row.value === null ? [] : [row.value])));
    const modelOf = (id: string): ChartModel | undefined => models.find((model) => model.id === id);

    return (
        <div ref={measure} className="h-full min-h-0 min-w-0" onKeyDownCapture={clearOnEscape(reference, onClear)}>
            <PointChart.Root
                data={rows}
                rows="points"
                x="value"
                xScale={scale}
                xOptions={scale === 'linear' ? { min: 0, max: linear.ticks.at(-1) } : undefined}
                rowKey="key"
                rowLabel={(row) => t(`efforts.${row.effort}`, { defaultValue: row.effort })}
                group="modelId"
                groupLabel={(row) => modelOf(row.modelId)?.name ?? row.modelId}
                y={{ step: 10 }}
                label={t(axisMetric === 'costPerTask' ? 'views.comparison' : 'views.speed')}
                height={260}
                grow
                margin={{ top: 34 }}
                surface="raised"
                selected={[reference, candidate].filter((key) => key !== null)}
                onActivate={(row) => onActivate(row.key)}
                onActiveXChange={(x) => onPreview(x === null ? null : String(x))}
                dimmed={(row) => (highlighted !== null && row.modelId !== highlighted) || (reference !== null && !involved.has(row.modelId))}
            >
                <PointChart.Grid dashed />
                <PointChart.YAxis title={t('metrics.intelligence')} format={(value) => formatDecimal(value)} />
                <PointChart.XAxis
                    title={t(`${compact ? 'metrics' : 'axes'}.${axisMetric}`)}
                    label={t(`metrics.${axisMetric}`)}
                    logLabel={t(compact ? 'dialog.scales.log' : 'chart.logarithmic')}
                    format={(value) => formatMetric(Number(value), axisMetric, true)}
                />
                {showFrontier && <PointChart.Frontier lowerX={lowerIsBetter(axisMetric)} tone={{ color: 'var(--chart-frontier)' }} />}
                <PointChart.Line value="score" label={t('metrics.intelligence')} tone={(row) => ({ color: row.color })} />
                <PointChart.Point value="score" label={t('metrics.intelligence')} tone={(row) => ({ color: row.color })} />
                <PointChart.EndLabels>
                    {(series) => {
                        const model = modelOf(series.key);
                        if (model === undefined) {
                            return null;
                        }
                        const name = shortModelName(model.name);
                        return (
                            <>
                                <LabLogo lab={model.lab} size={15} />
                                <span className="truncate">{compact ? name.replace(/^GPT-/, '') : name}</span>
                            </>
                        );
                    }}
                </PointChart.EndLabels>
            </PointChart.Root>
        </div>
    );
}
