import { Tooltip } from '@adecore/ui';
import type { ProcessMachine } from '@ruimte/contracts';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { RuimteMark } from '@/ui/RuimteMark';
import { barOf, type Bar } from './bars';
import { diskOf, formatBytes, formatPercent, formatRate } from './format';
import type { OutlineProject, Totals } from './outline';

const SWATCH = 'size-2 shrink-0 rounded-xs';
const SEGMENT = 'h-full min-w-0.5 transition-opacity hover:opacity-70';

function Swatch({ color }: { color: string | null }) {
    return color === null ? <span className={clsx(SWATCH, 'bg-text-faint')} /> : <span className={SWATCH} style={{ backgroundColor: color }} />;
}

function UsageBar({
    label,
    headline,
    ruimte,
    bar,
    nameOf,
    format
}: {
    label: ReactNode;
    headline: string;
    ruimte: string;
    bar: Bar;
    nameOf(key: string): string;
    format(value: number): string;
}) {
    const { t } = useTranslation(['panels', 'processes']);
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2 text-sm">
                <span className="text-text-muted">{label}</span>
                <span className="ml-auto text-text tabular-nums">{headline}</span>
                <span className="text-xs text-text-muted tabular-nums">{t('processes.ofRuimte', { value: ruimte })}</span>
            </div>
            <div className="flex h-2 gap-px overflow-hidden rounded-sm bg-border-soft">
                {bar.parts.map((part) => (
                    <Tooltip key={part.key} label={`${nameOf(part.key)} · ${format(part.value)}`}>
                        <span
                            className={clsx(SEGMENT, part.color === null && 'bg-text-faint')}
                            style={{ width: `${part.percent}%`, ...(part.color === null ? {} : { backgroundColor: part.color }) }}
                        />
                    </Tooltip>
                ))}
                {bar.rest > 0 && (
                    <Tooltip label={`${t('processes:group.other')} · ${format(bar.restValue)}`}>
                        <span className={clsx(SEGMENT, 'usage-hatch')} style={{ width: `${bar.rest}%` }} />
                    </Tooltip>
                )}
            </div>
        </div>
    );
}

/*
 * CPU, memory and disk of the whole machine, each a bar of the projects in their own colors, Ruimte
 * itself in gray, the rest of the machine hatched and what is free left empty. Disk has no ceiling, so
 * its whole is a round number over the peak of the series.
 */
export function ProcessBars({
    projects,
    machine,
    endpointId,
    diskScale
}: {
    projects: readonly OutlineProject[];
    machine: ProcessMachine;
    endpointId: string;
    diskScale: number;
}) {
    const { t } = useTranslation(['panels', 'processes']);
    const keyOf = (project: OutlineProject): string => project.projectId ?? 'ruimte';
    const nameOf = (key: string): string => projects.find((project) => keyOf(project) === key)?.summary?.name ?? t('processes.ruimteItself');
    const partsOf = (measure: (totals: Totals) => number | null) =>
        projects.map((project) => ({ key: keyOf(project), color: project.summary?.color ?? null, value: measure(project.totals) }));
    const sum = (measure: (totals: Totals) => number | null): number | null =>
        projects.reduce<number | null>((total, project) => {
            const value = measure(project.totals);
            return value === null ? total : (total ?? 0) + value;
        }, null);
    const cpuShare = (totals: Totals): number | null => (totals.cpu === null ? null : totals.cpu / machine.cores);
    const machineDisk = diskOf(machine);

    return (
        <div className="flex shrink-0 flex-col gap-3 border-b border-border p-3">
            <UsageBar
                label={t('processes.column.cpu')}
                headline={formatPercent(machine.cpu)}
                ruimte={formatPercent(sum(cpuShare))}
                bar={barOf(partsOf(cpuShare), machine.cpu, 100)}
                nameOf={nameOf}
                format={formatPercent}
            />
            <UsageBar
                label={t('processes.column.memory')}
                headline={t('processes.memoryHeadline', { used: formatBytes(machine.memoryUsed), total: formatBytes(machine.memoryTotal) })}
                ruimte={formatBytes(sum((totals) => totals.memory))}
                bar={barOf(
                    partsOf((totals) => totals.memory),
                    machine.memoryUsed,
                    machine.memoryTotal
                )}
                nameOf={nameOf}
                format={formatBytes}
            />
            <UsageBar
                label={
                    <Tooltip
                        label={`${t('processes.diskTooltip')}${machine.diskFree === null ? '' : ` ${t('processes.diskFree', { size: formatBytes(machine.diskFree) })}`}`}
                    >
                        <span>{t('processes.column.disk')}</span>
                    </Tooltip>
                }
                headline={formatRate(machineDisk)}
                ruimte={formatRate(sum((totals) => totals.disk))}
                bar={barOf(
                    partsOf((totals) => totals.disk),
                    machineDisk,
                    diskScale
                )}
                nameOf={nameOf}
                format={formatRate}
            />
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
                {projects.map((project) => (
                    <span key={keyOf(project)} className="flex min-w-0 items-center gap-1.5">
                        <Swatch color={project.summary?.color ?? null} />
                        {project.summary === null ? (
                            <RuimteMark size={12} />
                        ) : (
                            <ProjectGlyph
                                projectId={project.summary.projectId}
                                endpointId={endpointId}
                                icon={project.summary.icon}
                                color={project.summary.color}
                                size={12}
                                scratch={project.summary.scratch === true}
                            />
                        )}
                        <span className="truncate">{nameOf(keyOf(project))}</span>
                    </span>
                ))}
                <span className="flex items-center gap-1.5">
                    <span className={clsx(SWATCH, 'usage-hatch')} />
                    {t('processes:group.other')}
                </span>
            </div>
        </div>
    );
}
