import { useId, useState } from 'react';
import clsx from 'clsx';
import { Search, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton, Input, Switch, Tooltip } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import { ProviderLogo } from '@adecore/agents-react/agents/ProviderLogo';
import type { UsageProvider } from '@ruimte/contracts';
import type { ChartModel, ModelMark } from './chart';
import { shortModelName } from './comparison';
import { ModelsReasoningFilter } from './ModelsReasoningFilter';

interface ModelsLegendProps {
    models: readonly ChartModel[];
    marks: ReadonlyMap<string, ModelMark>;
    hidden: ReadonlySet<string>;
    hiddenEfforts: ReadonlySet<string>;
    efforts: readonly string[];
    available: ReadonlySet<string>;
    showLegacy: boolean;
    onToggle(id: string): void;
    onEffort(effort: string): void;
    onHighlight(id: string | null): void;
    onShowLegacy(show: boolean): void;
    onProvider(provider: string, show: boolean): void;
    onReset(): void;
    onClose(): void;
}

const PROVIDERS: readonly UsageProvider[] = ['claude', 'codex'];

export function ModelsLegend({
    models,
    marks,
    hidden,
    hiddenEfforts,
    efforts,
    available,
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
    const searchId = useId();
    const [search, setSearch] = useState('');
    const shown = models.filter((model) => model.name.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()));
    const selected = models.filter((model) => !hidden.has(model.id) && model.points.length > 0).length;
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
                    id={searchId}
                    icon={Search}
                    size="sm"
                    aria-label={t('filters.search')}
                    placeholder={t('filters.search')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <ModelsReasoningFilter efforts={efforts} hidden={hiddenEfforts} onToggle={onEffort} />
            </div>
            <div className="min-h-0 grow overflow-y-auto px-3 pb-3" role="group" aria-label={t('legend.label')}>
                {PROVIDERS.map((provider) => {
                    const own = shown.filter((model) => model.provider === provider);
                    const all = models.filter((model) => model.provider === provider && model.points.length > 0);
                    const selectedAll = all.every((model) => !hidden.has(model.id));
                    return own.length === 0 ? null : (
                        <div key={provider} className="mb-4">
                            <div className="mb-1 flex items-center justify-between px-1 text-xs">
                                <span className="font-medium text-text">{provider === 'claude' ? 'Anthropic' : 'OpenAI'}</span>
                                <Button size="sm" variant="ghost" onClick={() => onProvider(provider, !selectedAll)}>
                                    {t(selectedAll ? 'filters.none' : 'filters.all')}
                                </Button>
                            </div>
                            {own.map((model) => {
                                const measured = model.points.length > 0;
                                const selected = measured && !hidden.has(model.id);
                                const matches = available.has(model.id);
                                const color = marks.get(model.id)?.color ?? 'var(--text-muted)';
                                return (
                                    <Tooltip
                                        key={model.id}
                                        label={!measured ? t('legend.notMeasured') : !matches ? t('legend.filtered') : model.name}
                                        side="left"
                                    >
                                        <button
                                            type="button"
                                            aria-label={model.name}
                                            aria-pressed={selected}
                                            disabled={!measured}
                                            className={clsx(
                                                'flex min-h-7 w-full items-center gap-2 rounded px-1 text-left text-xs enabled:hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent max-[760px]:min-h-9',
                                                selected ? 'text-text' : 'text-text-faint'
                                            )}
                                            onClick={() => onToggle(model.id)}
                                            onPointerEnter={() => selected && onHighlight(model.id)}
                                            onPointerLeave={() => onHighlight(null)}
                                            onFocus={() => selected && onHighlight(model.id)}
                                            onBlur={() => onHighlight(null)}
                                        >
                                            <span style={{ color }} className={clsx(!selected && 'opacity-40')}>
                                                <ProviderLogo provider={model.provider} size={14} />
                                            </span>
                                            <span className="min-w-0 grow truncate">{shortModelName(model.name)}</span>
                                            {!measured ? (
                                                <span className="text-text-faint">{t('legend.notMeasured')}</span>
                                            ) : (
                                                <span
                                                    className="size-1.5 shrink-0 rounded-full border"
                                                    style={{
                                                        borderColor: color,
                                                        background: selected && matches ? color : 'transparent',
                                                        opacity: selected ? 1 : 0.4
                                                    }}
                                                />
                                            )}
                                        </button>
                                    </Tooltip>
                                );
                            })}
                        </div>
                    );
                })}
                {shown.length === 0 && <p className="px-1 py-3 text-xs text-text-muted">{t('filters.noResults')}</p>}
            </div>
            <label className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-text-muted">
                {t('legend.legacy')}
                <Switch checked={showLegacy} onCheckedChange={onShowLegacy} label={t('legend.legacy')} />
            </label>
        </div>
    );
}
