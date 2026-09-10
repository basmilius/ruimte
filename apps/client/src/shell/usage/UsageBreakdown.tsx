import { useState } from 'react';
import { CircleHelp, Folder, Info } from 'lucide-react';
import type { UsageModel, UsageProject, UsageSummaryResult } from '@ruimte/contracts';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { Segmented } from '@/shell/settings/controls';
import { useProject } from '@/state/project';
import type { UsageMetric } from '@/state/usage';
import { SECTION_LABEL } from '@/ui/classes';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';
import {
    displayModel,
    formatCount,
    formatTokens,
    formatUsd,
    PROVIDER_COLORS,
    PROVIDER_LABELS,
    shortPath,
    totalTokensOf,
    USAGE_PROVIDERS
} from '@/shell/usage/format';

type Breakdown = 'models' | 'projects';

const TABS: readonly { id: Breakdown; label: string }[] = [
    { id: 'models', label: 'Models' },
    { id: 'projects', label: 'Projects' }
];

/* The row of both tables: the same height and the same hover as a commit row in the git panel. */
const ROW = 'flex h-8 items-center gap-2 rounded-md px-2 text-xs hover:bg-surface-hover';

const HEAD = 'flex h-6 items-center gap-2 px-2 text-xs text-text-faint';

/* A share of the biggest row, never under one pixel: a row that did something has to be visible. */
const barWidth = (value: number, top: number): number => (value <= 0 || top <= 0 ? 0 : Math.max(1, Math.round((value / top) * 100)));

function ProviderDot({ provider }: { provider: UsageModel['provider'] }) {
    return (
        <Tooltip label={PROVIDER_LABELS[provider]}>
            <span className="size-2 shrink-0 rounded-full" style={{ background: PROVIDER_COLORS[provider] }} />
        </Tooltip>
    );
}

function ModelRows({ models, metric, total }: { models: readonly UsageModel[]; metric: UsageMetric; total: number }) {
    /* On the tokens metric the biggest row is the one that moved the most, not the dearest. */
    const sorted = [...models].sort((a, b) =>
        metric === 'tokens' ? totalTokensOf(b.totals) - totalTokensOf(a.totals) : (b.costUsd ?? -1) - (a.costUsd ?? -1)
    );
    return (
        <div className="flex flex-col">
            <div className={HEAD}>
                <span className="grow">Model</span>
                <span className="w-16 text-right">Calls</span>
                <span className="w-16 text-right">Input</span>
                <span className="w-16 text-right">Output</span>
                <span className="w-24 text-right">Cache R/W</span>
                <span className="w-20 text-right">Cost</span>
                <span className="w-12 text-right">Share</span>
            </div>
            {sorted.map((model) => (
                <div key={`${model.provider} ${model.model}`} className={ROW}>
                    <ProviderDot provider={model.provider} />
                    <Tooltip label={model.model}>
                        <span className="truncate">{displayModel(model.model)}</span>
                    </Tooltip>
                    {model.priceBasis === 'family' && model.pricedAs !== null && (
                        <Tooltip label={`Priced as ${model.pricedAs}`}>
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
                            <Tooltip label="No price known for this model">
                                <span className="inline-flex items-center gap-1 text-text-faint">
                                    <Icon icon={CircleHelp} size={12} />?
                                </span>
                            </Tooltip>
                        ) : (
                            formatUsd(model.costUsd)
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

function ProjectRows({ projects }: { projects: readonly UsageProject[] }) {
    const summaries = useProject((s) => s.projects);
    const top = Math.max(...projects.map((project) => project.costUsd), 0);
    return (
        <div className="flex flex-col gap-1">
            {projects.map((project) => {
                const summary = summaries.find((candidate) => candidate.projectId === project.projectId);
                return (
                    <div key={project.folder} className={`${ROW} h-auto py-1.5`}>
                        {summary ? (
                            <ProjectGlyph projectId={summary.projectId} icon={summary.icon} color={summary.color} size={16} />
                        ) : (
                            <span className="text-text-faint">
                                <Icon icon={Folder} size={16} />
                            </span>
                        )}
                        <span className="flex min-w-0 grow flex-col">
                            <span className="truncate">{summary?.name ?? project.name}</span>
                            <span className="truncate text-text-faint">{shortPath(project.folder)}</span>
                        </span>
                        <span className="flex h-[9px] w-32 shrink-0 overflow-hidden rounded-full bg-surface-sunken">
                            {USAGE_PROVIDERS.map((provider) => {
                                const share = project.byProvider[provider];
                                const width = barWidth(share?.costUsd ?? 0, top);
                                return width === 0 ? null : <span key={provider} style={{ width: `${width}%`, background: PROVIDER_COLORS[provider] }} />;
                            })}
                        </span>
                        <span className="w-20 text-right tabular-nums">{formatUsd(project.costUsd)}</span>
                        <span className="w-16 text-right tabular-nums text-text-muted">{formatTokens(totalTokensOf(project.totals))}</span>
                    </div>
                );
            })}
        </div>
    );
}

/* The same period cut two ways: what was spent on which model, and in which checkout. */
export function UsageBreakdown({ summary, metric }: { summary: UsageSummaryResult; metric: UsageMetric }) {
    const [tab, setTab] = useState<Breakdown>('models');
    const total = summary.models.reduce((sum, model) => sum + (model.costUsd ?? 0), 0);
    return (
        <section className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
                <h2 className={SECTION_LABEL}>Breakdown</h2>
                <div className="ml-auto">
                    <Segmented value={tab} options={TABS} onChange={(id) => setTab(id)} label="Breakdown" />
                </div>
            </div>
            {tab === 'models' ? <ModelRows models={summary.models} metric={metric} total={total} /> : <ProjectRows projects={summary.projects} />}
        </section>
    );
}
