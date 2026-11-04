import { SeriesLegend } from '@adecore/charts';
import { IconButton, Input, ScrollArea, Switch } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import type { BenchmarkLab } from '@ruimte/pulsar';
import { Search, RotateCcw, X } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartModel, ModelMark } from './chart';
import { shortModelName, type Metric } from './comparison';
import { LabLogo } from './LabLogo';
import { ModelsReasoningFilter } from './ModelsReasoningFilter';

interface ModelsLegendProps {
    labs: readonly BenchmarkLab[];
    models: readonly ChartModel[];
    marks: ReadonlyMap<string, ModelMark>;
    hidden: ReadonlySet<string>;
    hiddenEfforts: ReadonlySet<string>;
    efforts: readonly string[];
    available: ReadonlySet<string>;
    measured: ReadonlySet<string>;
    metric: Metric;
    showLegacy: boolean;
    onToggle(id: string): void;
    onEffort(effort: string): void;
    onHighlight(id: string | null): void;
    onShowLegacy(show: boolean): void;
    onProvider(provider: string, show: boolean): void;
    onReset(): void;
    onClose(): void;
}

/* The width under which the sidebar lies over the chart, where the rows are touch targets. */
const NARROW = '(max-width: 760px)';

function subscribeNarrow(onChange: () => void): () => void {
    const query = window.matchMedia(NARROW);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
}

function useNarrow(): boolean {
    return useSyncExternalStore(
        subscribeNarrow,
        () => window.matchMedia(NARROW).matches,
        () => false
    );
}

export function ModelsLegend({
    labs,
    models,
    marks,
    hidden,
    hiddenEfforts,
    efforts,
    available,
    measured: measuredModels,
    metric,
    showLegacy,
    onToggle,
    onEffort,
    onHighlight,
    onShowLegacy,
    onProvider,
    onReset,
    onClose
}: ModelsLegendProps) {
    const { t } = useTranslation('models');
    const narrow = useNarrow();
    const [search, setSearch] = useState('');
    const selected = models.filter((model) => !hidden.has(model.id) && model.points.length > 0).length;

    // A group's All or None changes several models at once, which the reducer takes as one step so its notice survives.
    const changeHidden = (next: string[]): void => {
        const after = new Set(next);
        const changed = models.filter((model) => hidden.has(model.id) !== after.has(model.id));
        if (changed.length === 1) {
            onToggle(changed[0]!.id);
        } else if (changed.length > 1) {
            onProvider(changed[0]!.lab.id, !after.has(changed[0]!.id));
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 flex-col gap-4 px-4 pt-3 pb-3">
                <div className="flex items-center gap-2">
                    <h3 className="grow text-sm font-semibold text-text">
                        {t('legend.label')} <span className="ml-1 text-xs font-normal tabular-nums text-text-muted">{formatNumber(selected)}</span>
                    </h3>
                    <IconButton
                        icon={RotateCcw}
                        size="sm"
                        label={t('filters.reset')}
                        onClick={() => {
                            setSearch('');
                            onReset();
                        }}
                    />
                    <IconButton icon={X} size="sm" label={t('filters.close')} onClick={onClose} className="min-[761px]:hidden" />
                </div>
                <Input
                    icon={Search}
                    size="sm"
                    aria-label={t('filters.search')}
                    placeholder={t('filters.search')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <ModelsReasoningFilter efforts={efforts} hidden={hiddenEfforts} onToggle={onEffort} />
            </div>
            <ScrollArea className="grow" viewportClassName="px-3 pb-3">
                <SeriesLegend
                    label={t('legend.label')}
                    search={false}
                    query={search}
                    empty={t('filters.noResults')}
                    size={narrow ? 'md' : 'sm'}
                    items={models.map((model) => {
                        const measured = model.points.length > 0;
                        const on = measured && !hidden.has(model.id);
                        const status = !measured
                            ? t('legend.notMeasured')
                            : !on
                              ? t('legend.hidden')
                              : !measuredModels.has(model.id)
                                ? t(`legend.missing.${metric}`)
                                : !available.has(model.id)
                                  ? t('legend.filtered')
                                  : undefined;
                        return {
                            key: model.id,
                            label: shortModelName(model.name),
                            name: model.name,
                            group: model.lab.id,
                            color: marks.get(model.id)?.color,
                            disabled: !measured,
                            status
                        };
                    })}
                    groups={labs.map((lab) => ({ key: lab.id, label: lab.name }))}
                    hidden={[...hidden]}
                    onHiddenChange={changeHidden}
                    onHighlightedChange={onHighlight}
                    mark={(item) => {
                        const lab = labs.find((entry) => entry.id === item.group);
                        return lab === undefined ? null : <LabLogo lab={lab} size={14} />;
                    }}
                />
            </ScrollArea>
            <label className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-text-muted">
                {t('legend.legacy')}
                <Switch checked={showLegacy} onCheckedChange={onShowLegacy} label={t('legend.legacy')} />
            </label>
        </div>
    );
}
