import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton, Select } from '@adecore/ui';
import { formatDecimal, formatRounded } from '@adecore/ui/format';
import { ProviderLogo } from '@adecore/agents-react/agents/ProviderLogo';
import type { ChartModel, ModelMark } from './chart';
import { formatMetric, metricChange, metricValue, METRICS, shortModelName, type ModelPoint } from './comparison';

interface ModelsPointComparisonProps {
    models: readonly ChartModel[];
    marks: ReadonlyMap<string, ModelMark>;
    points: readonly ModelPoint[];
    reference: ModelPoint | null;
    candidate: ModelPoint | null;
    selectedCandidate: string | null;
    onCandidate(key: string): void;
    onClear(): void;
}

export function ModelsPointComparison({ models, marks, points, reference, candidate, selectedCandidate, onCandidate, onClear }: ModelsPointComparisonProps) {
    const { t } = useTranslation('models');
    const shown = candidate ?? reference;
    if (shown === null) {
        return null;
    }
    const comparing = reference !== null && candidate !== null && reference.key !== candidate.key;
    const model = models.find((model) => model.id === shown.modelId)!;
    const label = (point: ModelPoint): string => `${shortModelName(point.modelName)} · ${t(`efforts.${point.effort}`, { defaultValue: point.effort })}`;
    const metrics = METRICS.filter((metric) => metricValue(shown, metric) !== null || (reference !== null && metricValue(reference, metric) !== null));
    return (
        <section
            aria-label={t('compare.label')}
            className="pointer-events-none absolute top-8 left-4 z-10 w-96 max-w-[calc(100%-2rem)] rounded-lg border border-border-strong bg-surface-raised/95 p-3 shadow-lg backdrop-blur-sm max-[760px]:pointer-events-auto max-[760px]:top-5 max-[760px]:max-h-[60%] max-[760px]:overflow-y-auto"
        >
            <div className="flex items-center gap-2">
                <span style={{ color: marks.get(model.id)?.color }}>
                    <ProviderLogo provider={model.provider} size={14} />
                </span>
                <p className="min-w-0 grow text-xs font-semibold text-text">{label(shown)}</p>
                {reference !== null && <IconButton size="sm" icon={X} label={t('compare.clear')} onClick={onClear} className="pointer-events-auto" />}
            </div>
            {reference !== null && <p className="mt-2 text-xs text-text-muted">{t('compare.pinned', { measurement: label(reference) })}</p>}
            {reference !== null && (
                <Select
                    value={candidate?.key ?? selectedCandidate}
                    onValueChange={onCandidate}
                    label={t('compare.candidate')}
                    placeholder={t('compare.choose')}
                    size="sm"
                    variant="ghost"
                    className="pointer-events-auto mt-1 w-full max-w-full"
                    items={points.filter((point) => point.key !== reference.key).map((point) => ({ value: point.key, label: label(point) }))}
                />
            )}
            <table className="mt-2 w-full border-collapse text-xs tabular-nums">
                {reference !== null && (
                    <thead>
                        <tr className="text-right font-normal text-text-faint">
                            <th>
                                <span className="sr-only">{t('compare.metric')}</span>
                            </th>
                            <th className="pb-1 font-normal">A</th>
                            <th className="pb-1 font-normal">B</th>
                            <th className="pb-1 font-normal">{t('compare.change')}</th>
                        </tr>
                    </thead>
                )}
                <tbody>
                    {metrics.map((metric) => {
                        const value = reference !== null && !comparing ? null : metricValue(shown, metric);
                        const original = reference === null ? null : metricValue(reference, metric);
                        const change = comparing ? metricChange(reference, candidate!, metric) : null;
                        return (
                            <tr key={metric} className="first:border-t first:border-border">
                                <th className="py-1.5 pr-2 text-left font-normal text-text-muted">{t(`metrics.${metric}`)}</th>
                                {reference !== null && (
                                    <td className="py-1.5 pl-2 text-right text-text">
                                        {original === null ? t('compare.unavailable') : formatMetric(original, metric)}
                                    </td>
                                )}
                                <td className="py-1.5 pl-2 text-right font-medium text-text">
                                    {value === null ? t('compare.unavailable') : formatMetric(value, metric)}
                                </td>
                                {reference !== null && (
                                    <td className="py-1.5 pl-2 text-right font-medium text-text">
                                        {change === null
                                            ? t('compare.unavailable')
                                            : change.ratio
                                              ? `${change.value > 0 && change.value < 0.001 ? `<${formatRounded(0.001, 3)}` : formatRounded(change.value, 3)}×`
                                              : `${change.value > 0 ? '+' : ''}${formatDecimal(change.value)}`}
                                    </td>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <p className="mt-2 text-xs text-text-faint">{t(reference === null ? 'compare.pinHint' : 'compare.changeHint')}</p>
        </section>
    );
}
