import { useId, useMemo, useReducer, useState } from 'react';
import clsx from 'clsx';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ModelBenchmarksResult } from '@ruimte/pulsar';
import { Button, Checkbox, EmptyState, IconButton, Segmented, Tabs, Tooltip } from '@adecore/ui';
import { formatNumber, useFormatLocale } from '@adecore/ui/format';
import { chartModels, modelMarks, type CostScale } from './chart';
import {
    barAxis,
    comparisonModels,
    initialSelection,
    measuredEfforts,
    metricValue,
    modelPoints,
    reduceComparison,
    MODEL_VIEWS,
    VIEW_METRICS,
    type ModelView
} from './comparison';
import { ModelsChart } from './ModelsChart';
import { ModelsBarChart } from './ModelsBarChart';
import { ModelsLegend } from './ModelsLegend';
import { ModelsPointComparison } from './ModelsPointComparison';

const SCALES: readonly CostScale[] = ['linear', 'log'];

export function ModelsComparison({ result }: { result: ModelBenchmarksResult }) {
    const { t } = useTranslation('models');
    useFormatLocale();
    const sidebarId = useId();
    const models = useMemo(() => chartModels(result.models, result.measurements), [result]);
    const marks = useMemo(() => modelMarks(models), [models]);
    const [selection, dispatch] = useReducer(reduceComparison.bind(null, models), undefined, initialSelection);
    const [view, setView] = useState<ModelView>('comparison');
    const [scale, setScale] = useState<CostScale>('log');
    const [grouped, setGrouped] = useState(true);
    const [showFrontier, setShowFrontier] = useState(true);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [highlighted, setHighlighted] = useState<string | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const { listed, selected, drawn } = useMemo(() => comparisonModels(models, selection), [models, selection]);
    const efforts = useMemo(() => measuredEfforts(listed), [listed]);
    const points = useMemo(() => modelPoints(drawn), [drawn]);
    const reference = points.find((point) => point.key === selection.reference) ?? null;
    const candidate =
        points.find((point) => point.key === (preview !== reference?.key ? preview : null)) ??
        points.find((point) => point.key === selection.candidate) ??
        null;
    const scatter = view === 'comparison' || view === 'speed';
    const metric = VIEW_METRICS[view];
    const available = new Set(
        points
            .filter((point) => {
                const value = metricValue(point, metric);
                return value !== null && (!scatter || (metricValue(point, 'intelligence') !== null && (scale !== 'log' || value > 0)));
            })
            .map((point) => point.modelId)
    );
    const visibleHighlight = highlighted !== null && available.has(highlighted) ? highlighted : null;
    const empty = listed.every((model) => model.points.length === 0)
        ? 'unavailable'
        : selected.every((model) => model.points.length === 0)
          ? 'models'
          : efforts.every((effort) => selection.hiddenEfforts.has(effort))
            ? 'efforts'
            : points.length === 0
              ? 'matching'
              : available.size === 0
                ? 'metric'
                : null;
    const interaction = {
        reference: selection.reference,
        candidate: reference === null ? null : (candidate?.key ?? null),
        onActivate: (key: string) => dispatch({ type: 'activate', key }),
        onPreview: setPreview,
        onClear: () => {
            setPreview(null);
            dispatch({ type: 'clear' });
        }
    };
    const reset = (): void => {
        setPreview(null);
        setHighlighted(null);
        dispatch({ type: 'reset' });
    };

    return (
        <Tabs.Root
            value={view}
            onValueChange={(next) => {
                setPreview(null);
                setView(next as ModelView);
            }}
            className="flex min-h-0 grow flex-col"
        >
            <Tabs.List
                aria-label={t('views.label')}
                className="shrink-0 px-5 max-[760px]:gap-2 max-[760px]:px-2"
                end={
                    <IconButton
                        size="sm"
                        icon={SlidersHorizontal}
                        label={t('legend.label')}
                        className="min-[761px]:hidden"
                        aria-expanded={filtersOpen}
                        aria-controls={sidebarId}
                        onClick={() => setFiltersOpen(!filtersOpen)}
                    />
                }
            >
                {MODEL_VIEWS.map((id) => (
                    <Tabs.Tab key={id} value={id} className="h-11 min-w-0 max-[760px]:shrink">
                        <span className="truncate">{t(`views.${id}`)}</span>
                    </Tabs.Tab>
                ))}
            </Tabs.List>
            <div className="relative grid min-h-0 grow grid-cols-[minmax(0,1fr)_15rem] max-[760px]:grid-cols-1">
                <div className="flex min-h-0 min-w-0 flex-col px-5 pt-4 pb-2 max-[760px]:px-2">
                    <header className="mb-2 flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-2">
                        <h2 className="text-sm font-semibold text-text">{t(`views.${view}`)}</h2>
                        <div className="flex items-center gap-4">
                            {scatter ? (
                                <>
                                    <Tooltip label={t('chart.frontier')}>
                                        <label className="flex min-h-8 cursor-pointer items-center gap-2 text-xs text-text-muted">
                                            <Checkbox checked={showFrontier} onCheckedChange={setShowFrontier} label={t('chart.pareto')} />
                                            {t('chart.pareto')}
                                        </label>
                                    </Tooltip>
                                    <Segmented<CostScale>
                                        value={scale}
                                        options={SCALES.map((id) => ({ id, label: t(`dialog.scales.${id}`) }))}
                                        onValueChange={setScale}
                                        label={t('dialog.scale')}
                                    />
                                </>
                            ) : (
                                <Segmented
                                    value={grouped ? 'grouped' : 'ranked'}
                                    options={[
                                        { id: 'grouped', label: t('bars.grouped') },
                                        { id: 'ranked', label: t('bars.ranked') }
                                    ]}
                                    onValueChange={(next) => setGrouped(next === 'grouped')}
                                    label={t('bars.order')}
                                />
                            )}
                        </div>
                    </header>
                    {MODEL_VIEWS.map((id) => (
                        <Tabs.Panel key={id} value={id} className="relative min-h-0 grow outline-none">
                            {id === view && (
                                <>
                                    {empty !== null ? (
                                        <EmptyState
                                            className="h-full"
                                            action={
                                                empty === 'unavailable' || empty === 'metric' ? undefined : (
                                                    <div className="flex flex-wrap gap-2">
                                                        {(empty === 'models' || empty === 'matching') && (
                                                            <Button size="sm" variant="secondary" onClick={() => dispatch({ type: 'models' })}>
                                                                {t('filters.resetModels')}
                                                            </Button>
                                                        )}
                                                        {(empty === 'efforts' || empty === 'matching') && (
                                                            <Button size="sm" variant="secondary" onClick={() => dispatch({ type: 'efforts' })}>
                                                                {t('filters.resetEfforts')}
                                                            </Button>
                                                        )}
                                                    </div>
                                                )
                                            }
                                        >
                                            {t(`empty.${empty}`)}
                                        </EmptyState>
                                    ) : view === 'comparison' || view === 'speed' ? (
                                        <ModelsChart
                                            models={drawn}
                                            originals={models}
                                            marks={marks}
                                            scale={scale}
                                            axisMetric={view === 'comparison' ? 'costPerTask' : 'outputSpeed'}
                                            showFrontier={showFrontier}
                                            highlighted={visibleHighlight}
                                            {...interaction}
                                        />
                                    ) : (
                                        <ModelsBarChart
                                            models={drawn}
                                            marks={marks}
                                            metric={view}
                                            grouped={grouped}
                                            axis={barAxis(selected, view)}
                                            highlighted={visibleHighlight}
                                            {...interaction}
                                        />
                                    )}
                                    <ModelsPointComparison
                                        models={models}
                                        marks={marks}
                                        points={points}
                                        reference={reference}
                                        candidate={candidate}
                                        selectedCandidate={selection.candidate}
                                        onCandidate={(key) => {
                                            setPreview(null);
                                            dispatch({ type: 'candidate', key });
                                        }}
                                        onClear={interaction.onClear}
                                    />
                                </>
                            )}
                        </Tabs.Panel>
                    ))}
                    <p role="status" className="mt-1 min-h-5 shrink-0 text-xs text-text-faint">
                        {selection.notice === null ? t('chart.hint') : t(`compare.notices.${selection.notice}`)}
                    </p>
                </div>
                <aside
                    id={sidebarId}
                    aria-label={t('filters.label')}
                    className={clsx(
                        'min-h-0 border-l border-border bg-surface-raised max-[760px]:absolute max-[760px]:inset-y-0 max-[760px]:right-0 max-[760px]:z-20 max-[760px]:w-64 max-[760px]:shadow-xl',
                        !filtersOpen && 'max-[760px]:hidden'
                    )}
                >
                    <ModelsLegend
                        models={listed}
                        marks={marks}
                        hidden={selection.hiddenModels}
                        hiddenEfforts={selection.hiddenEfforts}
                        efforts={efforts}
                        available={available}
                        showLegacy={selection.legacy}
                        onToggle={(id) => dispatch({ type: 'model', id })}
                        onEffort={(id) => dispatch({ type: 'effort', id })}
                        onHighlight={(id) => setHighlighted(drawn.some((model) => model.id === id) ? id : null)}
                        onShowLegacy={(value) => dispatch({ type: 'legacy', value })}
                        onProvider={(provider, show) => dispatch({ type: 'provider', provider, show })}
                        onReset={reset}
                        onClose={() => setFiltersOpen(false)}
                    />
                </aside>
            </div>
            <span className="sr-only">{t('filters.count', { count: selected.length, value: formatNumber(selected.length) })}</span>
        </Tabs.Root>
    );
}
