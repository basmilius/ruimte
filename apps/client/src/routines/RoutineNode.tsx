import { runtimeModeLabel } from '@adecore/agents-react/chat';
import { AgentModelLabel } from '@adecore/agents-react/providers';
import { ButtonGroup, Icon, IconButton, Pill, ScrollArea, Separator, Switch, Tooltip, useNow } from '@adecore/ui';
import { formatCountdown, formatDateTime } from '@adecore/ui/format';
import type { RoutineEntry, RoutineRun } from '@ruimte/contracts';
import clsx from 'clsx';
import { CalendarClock, CircleAlert, CirclePause, Clock, Folder, Hand, Play, Rocket, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { lookOfRun, type BlockLook } from '@/routines/agenda';
import { blockClass } from '@/routines/look-class';
import { runRoutineNow, setRoutinePaused } from '@/routines/routine-commands';
import { useRoutineList } from '@/routines/routine-list';
import { useRoutineWhat } from '@/routines/routine-what';
import { RoutinePrompt } from '@/routines/RoutinePrompt';
import { dayWords, rowStatus, runWords, scheduleWords, weekdayClock } from '@/routines/words';
import { useCanvas } from '@/state/canvas';
import { useEndpointId } from '@/state/current-endpoint';
import { useProject } from '@/state/project';
import { showRoutine } from '@/state/routines-stage';
import { NodeHeaderControls, NodePlate } from '@/surface/nodes/node-chrome';

// The newest runs the strip shows; the stage has the rest.
const STRIP_RUNS = 14;
const MINUTE_MS = 60_000;

/*
 * A routine of the window's project on a canvas, read from the machine's routine list the stage reads
 * too. The node holds only the routine's id, which travels in the shared file: a teammate whose machine
 * does not keep that routine sees it say so.
 */
export function RoutineNodeBody({ id }: { id: string }) {
    const { t } = useTranslation('routines');
    const routineId = useCanvas((s) => s.nodes[id]?.routine);
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const endpointId = useEndpointId();
    const list = useRoutineList(endpointId);
    if (list === null) {
        return <NodePlate icon={CircleAlert}>{t('node.noRoutines')}</NodePlate>;
    }
    if (list.status === 'loading') {
        return <NodePlate busy>{t('stage.loading')}</NodePlate>;
    }
    if (list.status === 'failed') {
        return <NodePlate icon={WifiOff}>{t('stage.failed')}</NodePlate>;
    }
    const entry = list.result.routines.find((candidate) => candidate.projectId === projectId && candidate.routine.id === routineId);
    if (entry === undefined) {
        return (
            <NodePlate icon={CalendarClock}>
                <span className="text-text">{t('node.notHere')}</span>
                <span>{t('node.notHereDetail')}</span>
            </NodePlate>
        );
    }
    return <RoutineOnCanvas endpointId={endpointId} entry={entry} timeZone={list.result.timeZone} />;
}

function RoutineOnCanvas({ endpointId, entry, timeZone }: { endpointId: string; entry: RoutineEntry; timeZone: string }) {
    const { t } = useTranslation('routines');
    const [picked, setPicked] = useState<string | null>(null);
    const target = { projectId: entry.projectId, routineId: entry.routine.id };
    const paused = entry.local.pausedAt !== undefined;
    const routine = entry.routine;
    const run = entry.runs.find((candidate) => candidate.runId === picked) ?? entry.runs.find((candidate) => candidate.state !== 'skipped') ?? entry.runs[0];
    const strip = entry.runs.slice(0, STRIP_RUNS).reverse();
    // A block opens its run where its chat is drawn: in Routines, at that run.
    const openRun = (runId: string): void => {
        setPicked(runId);
        showRoutine(target, runId);
    };
    return (
        // The node scrolls as a whole, so no part of it is squeezed to fit its height.
        <ScrollArea className={clsx('h-full w-full', paused && 'opacity-70')} viewportClassName="flex flex-col gap-3 p-3 *:shrink-0">
            <NodeHeaderControls>
                <Switch
                    checked={!paused && entry.local.declined !== entry.digest}
                    label={paused ? t('node.resume') : t('node.pause')}
                    disabled={!entry.approved}
                    onCheckedChange={(runs) => setRoutinePaused(endpointId, entry, !runs)}
                />
                <ButtonGroup render={<span />}>
                    <IconButton
                        icon={Play}
                        size="sm"
                        label={t('actions.runNow')}
                        disabled={!entry.approved}
                        onClick={() => void runRoutineNow(endpointId, entry)}
                    />
                    <IconButton icon={Clock} size="sm" label={t('node.openInRoutines')} onClick={() => showRoutine(target)} />
                </ButtonGroup>
                <Separator />
            </NodeHeaderControls>
            <p className="text-lg font-semibold text-text">{scheduleWords(routine.schedule)}</p>
            {routine.kind === 'agent' && (
                <div className="line-clamp-4 rounded-lg border border-border bg-surface-sunken bg-clip-padding px-3 py-2 text-text">
                    <RoutinePrompt endpointId={endpointId} entry={entry} />
                </div>
            )}
            {routine.kind === 'command' && (
                <p className="line-clamp-4 rounded-lg border border-border bg-surface-sunken bg-clip-padding px-3 py-2 font-mono text-code whitespace-pre-wrap text-text">
                    {routine.command}
                </p>
            )}
            <RoutineChips endpointId={endpointId} entry={entry} />
            <NextCard entry={entry} timeZone={timeZone} />
            <section className="flex flex-col gap-1.5" aria-label={t('detail.runs')}>
                {strip.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {strip.map((candidate) => (
                            <RunBlock key={candidate.runId} run={candidate} picked={candidate.runId === run?.runId} timeZone={timeZone} onOpen={openRun} />
                        ))}
                        {entry.next !== null && (
                            <span
                                data-look={paused ? 'paused' : 'next'}
                                role="img"
                                aria-label={t('node.nextBlock', { time: weekdayClock(entry.next, timeZone) })}
                                className={clsx('size-5', blockClass(paused ? 'paused' : 'next'))}
                            />
                        )}
                    </div>
                )}
                {strip.length > 0 && <StripCounts runs={strip} />}
                {run !== undefined && <p className="text-xs text-text-muted">{runSentence(run, timeZone)}</p>}
            </section>
        </ScrollArea>
    );
}

function runSentence(run: RoutineRun, timeZone: string): string {
    return `${dayWords(run.due, timeZone)}: ${runWords(run, timeZone)}`;
}

function RunBlock({ run, picked, timeZone, onOpen }: { run: RoutineRun; picked: boolean; timeZone: string; onOpen: (runId: string) => void }) {
    const { t } = useTranslation('routines');
    const look = lookOfRun(run);
    const label = `${dayWords(run.due, timeZone)}, ${t(`looks.${look}`)}`;
    return (
        <Tooltip label={label}>
            <button
                type="button"
                data-look={look}
                aria-pressed={picked}
                aria-label={label}
                className={clsx('size-5', blockClass(look))}
                onClick={() => onOpen(run.runId)}
            />
        </Tooltip>
    );
}

/* What the routine starts, as the chips under its instructions: the agent and model and its mode, a folder, or a launch. */
function RoutineChips({ endpointId, entry }: { endpointId: string; entry: RoutineEntry }) {
    const what = useRoutineWhat(entry);
    const routine = entry.routine;
    return (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {routine.kind === 'agent' && (
                <>
                    <Pill>
                        <AgentModelLabel scopeId={endpointId} provider={routine.provider} model={routine.selection?.model} size={12} />
                    </Pill>
                    <Pill>{runtimeModeLabel(routine.mode)}</Pill>
                </>
            )}
            {routine.kind === 'command' && <Pill icon={<Icon icon={Folder} size={12} />}>{routine.cwd ?? '.'}</Pill>}
            {routine.kind === 'launch' && <Pill icon={<Icon icon={Rocket} size={12} />}>{what}</Pill>}
        </div>
    );
}

/* When it runs next and how long that is from now; what stops it instead when it is paused, held or denied. */
function NextCard({ entry, timeZone }: { entry: RoutineEntry; timeZone: string }) {
    const { t } = useTranslation('routines');
    const now = useNow(MINUTE_MS);
    const status = rowStatus(entry, timeZone);
    const pausedAt = entry.local.pausedAt;
    const card = 'flex items-center gap-2.5 rounded-lg border border-border bg-surface-raised bg-clip-padding px-3 py-2';
    if (status.tone === 'needs') {
        return (
            <div className={clsx(card, 'text-status-needs-you')}>
                <Icon icon={Hand} size={16} className="shrink-0" />
                <span className="text-sm">{status.text}</span>
            </div>
        );
    }
    if (pausedAt !== undefined) {
        return (
            <div className={clsx(card, 'text-text-muted')}>
                <Icon icon={CirclePause} size={16} className="shrink-0" />
                <span className="text-sm">{t('band.since', { since: formatDateTime(pausedAt, { day: 'numeric', month: 'short', timeZone }) })}</span>
            </div>
        );
    }
    if (entry.next === null) {
        return (
            <div className={clsx(card, 'text-text-muted')}>
                <Icon icon={CalendarClock} size={16} className="shrink-0" />
                <span className="text-sm">{status.text}</span>
            </div>
        );
    }
    return (
        <div className={card}>
            <Icon icon={Clock} size={16} className="shrink-0 text-accent" />
            <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-text">{t('node.nextRun', { time: weekdayClock(entry.next, timeZone) })}</span>
                <span className="text-xs text-text-muted">{t('node.inTime', { time: formatCountdown(entry.next - now) })}</span>
            </span>
        </div>
    );
}

/* How the runs in the strip went, counted: the line under the blocks. */
function StripCounts({ runs }: { runs: readonly RoutineRun[] }) {
    const { t } = useTranslation('routines');
    const looks = runs.map(lookOfRun);
    const count = (...wanted: BlockLook[]): number => looks.filter((look) => wanted.includes(look)).length;
    const parts = (
        [
            ['node.countDone', count('done', 'waited', 'caught-up')],
            ['node.countWaited', count('waited')],
            ['node.countFailed', count('failed', 'limit')]
        ] as const
    ).flatMap(([key, counted]) => (counted > 0 ? [t(key, { count: counted })] : []));
    return (
        <p className="flex items-center justify-between gap-2 text-xs text-text-faint">
            <span>{t('node.lastRuns', { count: runs.length })}</span>
            <span className="truncate">{parts.join(' · ')}</span>
        </p>
    );
}
