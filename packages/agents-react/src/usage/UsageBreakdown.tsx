import { useState } from 'react';
import clsx from 'clsx';
import { CircleHelp, Folder, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UsageModel, UsageProject, UsageProvider, UsageSummaryResult } from '@ruimte/agent-contracts';
import { Segmented } from '@ruimte/ui/controls';
import { useChatScope } from '../scope';
import { chatHost } from '../host';
import type { UsageMetric } from '../state/usage';
import { SECTION_LABEL } from '@ruimte/ui/classes';
import { EmptyState } from '@ruimte/ui/EmptyState';
import { Tooltip } from '@ruimte/ui/Tooltip';
import { Icon } from '@ruimte/ui/Icon';
import { ProviderLogo } from '../agents/ProviderLogo';
import { USAGE_PROVIDERS, totalTokensOf } from '@ruimte/agent-contracts';
import { modelNameFromSlug } from '../agents/model-name';
import { formatCount, formatTokens, PROVIDER_COLORS, PROVIDER_LABELS, shortPath, slotLabel } from './format';
import { useMoney } from './money';
import { deriveDays } from './summary';

type Breakdown = 'models' | 'projects' | 'day';

/* The row of every table, the same height and the same hover as a commit row in the git panel. */
const ROW = 'flex h-8 items-center gap-2 rounded-md px-2 text-xs hover:bg-surface-hover';

const HEAD = 'flex h-6 items-center gap-2 px-2 text-xs text-text-faint';

/* A row is padded so its hover has room around the text, and the table pulls that padding back off
   again. The first column then starts on the same line as every other section of the page. */
const TABLE = '-mx-2 flex flex-col';

const TABS: readonly Breakdown[] = ['models', 'projects', 'day'];

/* A share of the biggest row, never under one pixel. A row that did something has to be visible. */
const barWidth = (value: number, top: number): number => (value <= 0 || top <= 0 ? 0 : Math.max(1, Math.round((value / top) * 100)));

function ProviderMark({ provider }: { provider: UsageProvider }) {
    return (
        <Tooltip label={PROVIDER_LABELS[provider]}>
            <span style={{ color: PROVIDER_COLORS[provider] }}>
                <ProviderLogo provider={provider} />
            </span>
        </Tooltip>
    );
}

function ModelRows({ models, metric, total }: { models: readonly UsageModel[]; metric: UsageMetric; total: number }) {
    const { t } = useTranslation('agent-usage');
    const money = useMoney();
    /* On the tokens metric the biggest row is the one that moved the most, not the dearest. */
    const sorted = [...models].sort((a, b) =>
        metric === 'tokens' ? totalTokensOf(b.totals) - totalTokensOf(a.totals) : (b.costUsd ?? -1) - (a.costUsd ?? -1)
    );
    return (
        <div className={TABLE}>
            <div className={HEAD}>
                <span className="grow">{t('breakdown.models.model')}</span>
                <span className="w-16 text-right">{t('breakdown.models.calls')}</span>
                <span className="w-16 text-right">{t('breakdown.models.input')}</span>
                <span className="w-16 text-right">{t('breakdown.models.output')}</span>
                <span className="w-24 text-right">{t('breakdown.models.cache')}</span>
                <span className="w-20 text-right">{t('breakdown.models.cost')}</span>
                <span className="w-12 text-right">{t('breakdown.models.share')}</span>
            </div>
            {sorted.map((model) => (
                <div key={`${model.provider} ${model.model}`} className={ROW}>
                    <ProviderMark provider={model.provider} />
                    <span className="truncate">{modelNameFromSlug(model.model)}</span>
                    {model.priceBasis === 'family' && model.pricedAs !== null && (
                        <Tooltip label={t('breakdown.models.pricedAs', { model: modelNameFromSlug(model.pricedAs) })}>
                            <span className="text-text-faint">
                                <Icon icon={Info} size={12} />
                            </span>
                        </Tooltip>
                    )}
                    <span className="ml-auto w-16 text-right tabular-nums text-text-muted">{formatCount(model.totals.calls)}</span>
                    <span className="w-16 text-right tabular-nums text-text-muted">{formatTokens(model.totals.input)}</span>
                    <span className="w-16 text-right tabular-nums text-text-muted">{formatTokens(model.totals.output)}</span>
                    <span className="w-24 text-right tabular-nums text-text-muted">
                        {formatTokens(model.totals.cacheRead)} / {formatTokens(model.totals.cacheWrite)}
                    </span>
                    <span className="w-20 text-right tabular-nums">
                        {model.costUsd === null ? (
                            <Tooltip label={t('breakdown.models.noPrice')}>
                                <span className="inline-flex items-center gap-1 text-text-faint">
                                    <Icon icon={CircleHelp} size={12} />?
                                </span>
                            </Tooltip>
                        ) : (
                            money(model.costUsd)
                        )}
                    </span>
                    <span className="w-12 text-right tabular-nums text-text-muted">
                        {model.costUsd === null || total <= 0 ? '' : `${Math.round((model.costUsd / total) * 100)}%`}
                    </span>
                </div>
            ))}
        </div>
    );
}

/* One project's row, under the name and the mark its host gives it, or its folder's own under a folder. */
function ProjectRow({ project, top, money }: { project: UsageProject; top: number; money(usd: number): string }) {
    // The usage on screen is one host's, so the look of a project is that host's too.
    const look = chatHost().useProjectLook(useChatScope().id, project.projectId);
    return (
        /* The mark sits on the title rather than between the two lines, so a column of icons lines
           up with the names beside it and not with the paths under them. */
        <div className={`${ROW} h-auto items-start py-1.5`}>
            <span className="mt-px flex">
                {look?.mark ?? (
                    <span className="text-text-faint">
                        <Icon icon={Folder} size={16} />
                    </span>
                )}
            </span>
            <span className="flex min-w-0 grow flex-col">
                <span className="truncate">{look?.name ?? project.name}</span>
                <span className="truncate text-text-faint">{shortPath(project.folder)}</span>
            </span>
            <span className="mt-1 flex h-[9px] w-32 shrink-0 overflow-hidden rounded-full bg-surface-sunken">
                {USAGE_PROVIDERS.map((provider) => {
                    const share = project.byProvider[provider];
                    const width = barWidth(share?.costUsd ?? 0, top);
                    return width === 0 ? null : <span key={provider} style={{ width: `${width}%`, background: PROVIDER_COLORS[provider] }} />;
                })}
            </span>
            <span className="w-20 text-right tabular-nums">{money(project.costUsd)}</span>
            <span className="w-16 text-right tabular-nums text-text-muted">{formatTokens(totalTokensOf(project.totals))}</span>
        </div>
    );
}

function ProjectRows({ projects }: { projects: readonly UsageProject[] }) {
    const money = useMoney();
    const top = Math.max(...projects.map((project) => project.costUsd), 0);
    return (
        <div className={clsx(TABLE, 'gap-1')}>
            {projects.map((project) => (
                <ProjectRow key={project.folder} project={project} top={top} money={money} />
            ))}
        </div>
    );
}

/* The chart written out per calendar day, a column per provider that did anything in the period. */
function DayRows({ summary, providers }: { summary: UsageSummaryResult; providers: readonly UsageProvider[] }) {
    const { t } = useTranslation('agent-usage');
    const money = useMoney();
    const rows = deriveDays(summary);
    if (rows.length === 0) {
        return <EmptyState>{t('breakdown.days.empty')}</EmptyState>;
    }
    return (
        <div className={TABLE}>
            <div className={HEAD}>
                <span className="grow">{t('breakdown.days.day')}</span>
                {providers.map((provider) => (
                    <span key={provider} className="w-20 text-right">
                        {PROVIDER_LABELS[provider]}
                    </span>
                ))}
                <span className="w-20 text-right">{t('breakdown.days.total')}</span>
                <span className="w-16 text-right">{t('breakdown.days.tokens')}</span>
            </div>
            {rows.map((row) => (
                <div key={row.slot} className={ROW}>
                    <span className="grow truncate">{slotLabel(row.slot)}</span>
                    {providers.map((provider) => (
                        <span key={provider} className="w-20 text-right tabular-nums text-text-muted">
                            {row.costByProvider[provider] === undefined ? '' : money(row.costByProvider[provider]!)}
                        </span>
                    ))}
                    <span className="w-20 text-right tabular-nums">{money(row.costUsd)}</span>
                    <span className="w-16 text-right tabular-nums text-text-muted">{formatTokens(row.tokens)}</span>
                </div>
            ))}
        </div>
    );
}

interface UsageBreakdownProps {
    summary: UsageSummaryResult;
    metric: UsageMetric;
    /* The providers that did anything, in the order the chart stacks them. */
    providers: readonly UsageProvider[];
}

/* The same period cut three ways: which model, which checkout, and which day it went on. */
export function UsageBreakdown({ summary, metric, providers }: UsageBreakdownProps) {
    const { t } = useTranslation('agent-usage');
    const [tab, setTab] = useState<Breakdown>('models');
    const total = summary.models.reduce((sum, model) => sum + (model.costUsd ?? 0), 0);
    return (
        <section className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
                <h2 className={SECTION_LABEL}>{t('breakdown.title')}</h2>
                <div className="ml-auto">
                    <Segmented
                        value={tab}
                        options={TABS.map((id) => ({ id, label: t(`breakdown.tabs.${id}`) }))}
                        onChange={(id) => setTab(id)}
                        label={t('breakdown.title')}
                    />
                </div>
            </div>
            {tab === 'models' && <ModelRows models={summary.models} metric={metric} total={total} />}
            {tab === 'projects' && <ProjectRows projects={summary.projects} />}
            {tab === 'day' && <DayRows summary={summary} providers={providers} />}
        </section>
    );
}
