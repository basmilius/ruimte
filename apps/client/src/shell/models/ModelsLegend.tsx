import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { UsageProvider } from '@ruimte/contracts';
import { Toggle } from '@ruimte/ui/controls';
import { markPath, type ChartModel, type ModelMark } from '@/shell/models/chart';
import { PROVIDER_LABELS } from '@ruimte/agents-react/usage/format';
import { ProviderLogo } from '@ruimte/agents-react/agents/ProviderLogo';

interface ModelsLegendProps {
    /* Every model the list shows, legacy ones only while they are asked for. */
    models: readonly ChartModel[];
    marks: ReadonlyMap<string, ModelMark>;
    hidden: ReadonlySet<string>;
    showLegacy: boolean;
    onToggle(id: string): void;
    onHighlight(id: string | null): void;
    onShowLegacy(show: boolean): void;
}

const PROVIDER_ORDER: readonly UsageProvider[] = ['claude', 'codex'];

/* The list beside the chart is its legend: pointing at a model lights its line, a click draws it or takes it away. */
export function ModelsLegend({ models, marks, hidden, showLegacy, onToggle, onHighlight, onShowLegacy }: ModelsLegendProps) {
    const { t } = useTranslation('models');
    return (
        <div className="flex min-h-0 flex-col gap-3">
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto" role="group" aria-label={t('legend.label')}>
                {PROVIDER_ORDER.map((provider) => {
                    const own = models.filter((model) => model.provider === provider);
                    if (own.length === 0) {
                        return null;
                    }
                    return (
                        <div key={provider} className="flex flex-col">
                            <p className="flex items-center gap-1.5 px-2 pb-1 text-xs font-medium text-text-muted">
                                <ProviderLogo provider={provider} size={12} />
                                {PROVIDER_LABELS[provider]}
                            </p>
                            {own.map((model) => {
                                const measured = model.points.length > 0;
                                const shown = measured && !hidden.has(model.id);
                                const mark = marks.get(model.id);
                                const color = measured ? (mark?.color ?? 'var(--text-muted)') : 'var(--border-strong)';
                                return (
                                    <button
                                        key={model.id}
                                        type="button"
                                        aria-pressed={shown}
                                        disabled={!measured}
                                        className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-xs enabled:hover:bg-surface-hover"
                                        onClick={() => onToggle(model.id)}
                                        onPointerEnter={() => shown && onHighlight(model.id)}
                                        onPointerLeave={() => onHighlight(null)}
                                        onFocus={() => shown && onHighlight(model.id)}
                                        onBlur={() => onHighlight(null)}
                                    >
                                        <svg width={12} height={12} className="shrink-0" aria-hidden>
                                            <path
                                                d={markPath(mark?.shape ?? 'circle', 6, 6, 3.5)}
                                                fill={shown ? color : 'none'}
                                                stroke={color}
                                                strokeWidth={1.5}
                                                strokeLinejoin="round"
                                            />
                                        </svg>
                                        <span className={clsx('min-w-0 grow truncate', shown ? 'text-text' : 'text-text-muted')}>{model.name}</span>
                                        {!measured && <span className="shrink-0 text-text-faint">{t('legend.notMeasured')}</span>}
                                    </button>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
            <p className="flex items-center gap-2 px-2 text-xs text-text-muted">
                <span className="h-2.5 w-4 shrink-0 rounded-full bg-(--chart-frontier)" />
                {t('chart.frontier')}
            </p>
            <div className="mt-auto flex items-center justify-between gap-2 px-2 text-xs text-text-muted">
                {t('legend.legacy')}
                <Toggle checked={showLegacy} onChange={onShowLegacy} label={t('legend.legacy')} />
            </div>
        </div>
    );
}
