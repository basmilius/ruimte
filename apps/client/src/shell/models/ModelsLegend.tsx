import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { UsageProvider } from '@ruimte/contracts';
import { Toggle } from '@/shell/settings/controls';
import type { ChartModel } from '@/shell/models/chart';
import { PROVIDER_LABELS } from '@/shell/usage/format';
import { ProviderLogo } from '@/ui/ProviderLogo';

interface ModelsLegendProps {
    /* Every model the list shows, legacy ones only while they are asked for. */
    models: readonly ChartModel[];
    colors: ReadonlyMap<string, string>;
    hidden: ReadonlySet<string>;
    showLegacy: boolean;
    onToggle(id: string): void;
    onHighlight(id: string | null): void;
    onShowLegacy(show: boolean): void;
}

const PROVIDER_ORDER: readonly UsageProvider[] = ['claude', 'codex'];

/* The list beside the chart is its legend: pointing at a model lights its line, a click draws it or takes it away. */
export function ModelsLegend({ models, colors, hidden, showLegacy, onToggle, onHighlight, onShowLegacy }: ModelsLegendProps) {
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
                                const color = colors.get(model.id) ?? 'var(--text-muted)';
                                return (
                                    <button
                                        key={model.id}
                                        type="button"
                                        aria-pressed={shown}
                                        disabled={!measured}
                                        className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-xs enabled:hover:bg-surface-sunken"
                                        onClick={() => onToggle(model.id)}
                                        onPointerEnter={() => shown && onHighlight(model.id)}
                                        onPointerLeave={() => onHighlight(null)}
                                        onFocus={() => shown && onHighlight(model.id)}
                                        onBlur={() => onHighlight(null)}
                                    >
                                        <span
                                            className="size-2.5 shrink-0 rounded-full border-2"
                                            style={{ borderColor: measured ? color : 'var(--border-strong)', background: shown ? color : 'transparent' }}
                                        />
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
