import { EmptyState, Icon, Popover, ScrollArea, Switch } from '@adecore/ui';
import { formatClock, formatDateTime } from '@adecore/ui/format';
import type { RoutineEntry, RoutineKind } from '@ruimte/contracts';
import clsx from 'clsx';
import { Bot, Pause, Rocket, SquareTerminal, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OutputProjectGlyph } from '@/output/look';
import { blocksOf, cellItems, LEGEND, NOON_MS, pausedBand, skippedWhilePaused, type AgendaBlock, type AgendaWeek, type CellItem } from '@/routines/agenda';
import { LookIcon } from '@/routines/look';
import { blockClass, HATCH } from '@/routines/look-class';
import { setRoutinePaused } from '@/routines/routine-commands';
import { useRoutineWhat } from '@/routines/routine-what';
import { RoutineRunPopover, type PickedRun } from '@/routines/RoutineRunPopover';
import { blockWords, dayWords, foldWords, rowStatus, scheduleWords } from '@/routines/words';
import { showRoutine } from '@/state/routines-stage';

const NAME_COLUMN = 248;
// A day never narrower than a block that says "09:00 · 3m"; a narrow stage scrolls sideways instead.
const GRID = 'grid grid-cols-[248px_repeat(7,minmax(100px,1fr))]';

const KIND_ICONS: Record<RoutineKind, LucideIcon> = {
    agent: Bot,
    command: SquareTerminal,
    launch: Rocket
};

export interface AgendaGroup {
    projectId: string;
    projectName: string;
    entries: RoutineEntry[];
}

interface AgendaProps {
    endpointId: string;
    groups: AgendaGroup[];
    week: AgendaWeek;
    now: number;
    timeZone: string;
    /* No routine to show: the empty state over the week has the attention, so nothing here asks for it. */
    empty?: boolean;
}

function todayIndex(week: AgendaWeek, now: number): number {
    return week.days.findIndex((day) => now >= day.start && now < day.end);
}

/*
 * The week: a row per routine under its project, with a block per run on the day it was due, the times
 * still to come outlined, and a line at now.
 */
export function RoutineAgenda({ endpointId, groups, week, now, timeZone, empty = false }: AgendaProps) {
    const { t } = useTranslation('routines');
    const [picked, setPicked] = useState<PickedRun | null>(null);
    const today = todayIndex(week, now);
    const nowAt = today < 0 ? null : (today + (now - week.days[today]!.start) / (week.days[today]!.end - week.days[today]!.start)) / 7;

    return (
        <ScrollArea axis="both" className="grow" viewportClassName="flex flex-col">
            <div className="relative isolate min-w-[948px] grow" role="grid" aria-label={t('agenda.label')}>
                {/* The days run to the bottom of the stage, however few routines there are. */}
                <div aria-hidden="true" className={`${GRID} pointer-events-none absolute inset-0 -z-10`}>
                    <span />
                    {week.days.map((day, index) => (
                        <span key={day.date} className={clsx('border-l border-border-soft', index === today && 'bg-surface-hover/40')} />
                    ))}
                </div>
                <div className={`${GRID} sticky top-0 z-[1] h-14 items-end border-b border-border bg-surface pb-2 text-xs`} role="row">
                    <span role="columnheader">
                        <span className="sr-only">{t('agenda.routine')}</span>
                    </span>
                    {week.days.map((day, index) => (
                        <span key={day.date} role="columnheader" className="flex px-2">
                            <span
                                className={clsx(
                                    'flex items-center gap-1 rounded-md px-1.5 py-0.5',
                                    index === today ? 'font-medium text-text' : 'text-text-muted'
                                )}
                            >
                                {formatDateTime(day.start + NOON_MS, { weekday: 'short', timeZone })}
                                <span className={clsx('font-medium tabular-nums', index !== today && 'text-text')}>
                                    {formatDateTime(day.start + NOON_MS, { day: 'numeric', timeZone })}
                                </span>
                            </span>
                        </span>
                    ))}
                </div>
                {groups.map((group) => (
                    <div key={group.projectId} role="rowgroup" aria-label={group.projectName}>
                        <div className="flex h-8 items-end gap-2 px-3 pb-1.5" role="row">
                            <span role="rowheader" className="flex min-w-0 items-center gap-2 text-2xs font-medium tracking-wide text-text-faint uppercase">
                                <OutputProjectGlyph endpointId={endpointId} projectId={group.projectId} size={12} />
                                <span className="truncate">{group.projectName}</span>
                            </span>
                        </div>
                        {group.entries.map((entry) => (
                            <AgendaRow
                                key={entry.routine.id}
                                endpointId={endpointId}
                                entry={entry}
                                week={week}
                                now={now}
                                timeZone={timeZone}
                                pickedRunId={picked?.run.runId ?? null}
                                onPick={setPicked}
                            />
                        ))}
                    </div>
                ))}
                {nowAt !== null && (
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute top-0 bottom-0 z-[2] w-px"
                        style={{ left: `calc(${NAME_COLUMN}px + (100% - ${NAME_COLUMN}px) * ${nowAt})` }}
                    >
                        <span className={clsx('absolute top-1 bottom-0 w-px', empty ? 'bg-text-faint' : 'bg-accent')} />
                        <span
                            className={clsx(
                                'absolute top-1 left-1/2 -translate-x-1/2 rounded-sm px-1 text-2xs font-medium tabular-nums',
                                empty ? 'bg-surface-raised text-text-muted' : 'bg-accent text-accent-text'
                            )}
                        >
                            {formatClock(now, timeZone)}
                        </span>
                    </div>
                )}
            </div>
            <RoutineRunPopover endpointId={endpointId} picked={picked} timeZone={timeZone} onClose={() => setPicked(null)} />
        </ScrollArea>
    );
}

/* The week as a list: the runs and coming times of every day that has any, in the order they come. */
export function RoutineWeekList({ endpointId, groups, week, now, timeZone }: Omit<AgendaProps, 'empty'>) {
    const { t } = useTranslation('routines');
    const [picked, setPicked] = useState<PickedRun | null>(null);
    const today = todayIndex(week, now);
    const items = groups.flatMap((group) => group.entries.flatMap((entry) => blocksOf(entry, week, now, timeZone).map((block) => ({ entry, block }))));
    const days = week.days.map((day, index) => ({
        day,
        index,
        name: formatDateTime(day.start + NOON_MS, { weekday: 'long', day: 'numeric', month: 'long', timeZone }),
        items: items.filter((item) => item.block.day === index).sort((left, right) => left.block.at - right.block.at)
    }));
    const shown = days.filter((day) => day.items.length > 0);

    return (
        <ScrollArea className="grow" viewportClassName="flex flex-col">
            {shown.length === 0 ? (
                <div className="grid grow place-items-center p-6">
                    <EmptyState>{t('list.empty')}</EmptyState>
                </div>
            ) : (
                <div className="flex flex-col gap-4 p-4" aria-label={t('agenda.label')}>
                    {shown.map(({ day, index, name, items: dayItems }) => (
                        <section key={day.date} className="flex flex-col gap-1" aria-label={name}>
                            <h3 className="flex items-center gap-2 px-1 pb-1 text-xs">
                                <span className={clsx('rounded-md px-1.5 py-0.5 font-medium', index === today ? 'bg-surface-hover text-text' : 'text-text')}>
                                    {name}
                                </span>
                            </h3>
                            {dayItems.map(({ entry, block }) => (
                                <div
                                    key={`${entry.projectId}:${entry.routine.id}:${block.key}`}
                                    className="flex min-w-0 items-center gap-3 rounded-md px-1 py-1 hover:bg-surface-hover"
                                    data-routine={entry.routine.id}
                                >
                                    <span className="w-32 shrink-0">
                                        <Block
                                            block={block}
                                            entry={entry}
                                            timeZone={timeZone}
                                            picked={picked?.run.runId === block.run?.runId && block.run !== null}
                                            onPick={setPicked}
                                        />
                                    </span>
                                    <button
                                        type="button"
                                        className="flex min-w-0 grow items-center gap-2 text-left"
                                        onClick={() => showRoutine({ projectId: entry.projectId, routineId: entry.routine.id })}
                                    >
                                        <Icon icon={KIND_ICONS[entry.routine.kind]} size={14} className="shrink-0 text-text-muted" />
                                        <span className="truncate text-sm text-text">{entry.routine.title}</span>
                                        <span className="flex min-w-0 shrink-0 items-center gap-1.5 text-xs text-text-faint">
                                            <OutputProjectGlyph endpointId={endpointId} projectId={entry.projectId} size={12} />
                                            {entry.projectName}
                                        </span>
                                    </button>
                                </div>
                            ))}
                        </section>
                    ))}
                </div>
            )}
            <RoutineRunPopover endpointId={endpointId} picked={picked} timeZone={timeZone} onClose={() => setPicked(null)} />
        </ScrollArea>
    );
}

/* What the blocks mean, in the tooltip of the stage's info button. */
export function AgendaLegend() {
    const { t } = useTranslation('routines');
    return (
        <ul className="grid gap-1.5 py-1" aria-label={t('side.legend')}>
            {LEGEND.map((look) => (
                <li key={look} className={clsx('flex h-6 items-center gap-1 px-2 text-2xs', blockClass(look))}>
                    <LookIcon look={look} />
                    {t(`legend.${look}`)}
                </li>
            ))}
        </ul>
    );
}

function AgendaRow({
    endpointId,
    entry,
    week,
    now,
    timeZone,
    pickedRunId,
    onPick
}: {
    endpointId: string;
    entry: RoutineEntry;
    week: AgendaWeek;
    now: number;
    timeZone: string;
    pickedRunId: string | null;
    onPick(picked: PickedRun): void;
}) {
    const { t } = useTranslation('routines');
    const what = useRoutineWhat(entry, false);
    const blocks = blocksOf(entry, week, now, timeZone);
    const band = pausedBand(entry, blocks, week, now);
    const status = rowStatus(entry, timeZone);
    const paused = entry.local.pausedAt !== undefined;
    const declined = entry.local.declined === entry.digest;
    const target = { projectId: entry.projectId, routineId: entry.routine.id };
    const subtitle =
        status.tone === 'needs' || declined
            ? status.text
            : [scheduleWords(entry.routine.schedule), what, paused ? t('row.paused') : null].filter((part) => part !== null).join(' · ');
    const cells = band === null ? week.days : week.days.slice(0, band.from);
    return (
        <div className={`${GRID} min-h-12 border-b border-border-soft`} role="row" data-routine={entry.routine.id}>
            <div className="flex min-w-0 items-center gap-2.5 px-3 py-1.5" role="rowheader">
                <button type="button" className="flex min-w-0 grow flex-col items-start text-left" onClick={() => showRoutine(target)}>
                    <span className={clsx('w-full truncate text-sm font-medium hover:underline', declined ? 'text-text-muted' : 'text-text')}>
                        {entry.routine.title}
                    </span>
                    <span className={clsx('w-full truncate text-xs', status.tone === 'needs' ? 'text-status-needs-you' : 'text-text-muted')}>{subtitle}</span>
                </button>
                <Switch
                    checked={!paused && !declined}
                    label={t(paused ? 'actions.resume' : 'actions.pause')}
                    disabled={!entry.approved}
                    onCheckedChange={(on) => setRoutinePaused(endpointId, entry, !on)}
                />
            </div>
            {cells.map((day, index) => (
                <div key={day.date} role="gridcell" className="flex min-w-0 flex-col gap-1 p-1">
                    {cellItems(
                        blocks.filter((block) => block.day === index),
                        entry.routine.schedule
                    ).map((item) =>
                        item.kind === 'block' ? (
                            <Block
                                key={item.key}
                                block={item.block}
                                entry={entry}
                                timeZone={timeZone}
                                picked={item.block.run !== null && item.block.run.runId === pickedRunId}
                                onPick={onPick}
                            />
                        ) : item.kind === 'runs' ? (
                            <FoldedRuns key={item.key} item={item} entry={entry} timeZone={timeZone} pickedRunId={pickedRunId} onPick={onPick} />
                        ) : (
                            <ComingChip key={item.key} item={item} entry={entry} timeZone={timeZone} />
                        )
                    )}
                </div>
            ))}
            {band !== null && (
                <div role="gridcell" className="min-w-0 p-1" style={{ gridColumn: `span ${band.to - band.from + 1}` }}>
                    <PausedBand endpointId={endpointId} entry={entry} timeZone={timeZone} />
                </div>
            )}
        </div>
    );
}

/* What is left of the week for a paused routine, in one hatched band rather than a block per time it skips. */
function PausedBand({ endpointId, entry, timeZone }: { endpointId: string; entry: RoutineEntry; timeZone: string }) {
    const { t } = useTranslation('routines');
    const since = dayWords(entry.local.pausedAt!, timeZone);
    const skipped = skippedWhilePaused(entry);
    return (
        <div
            className={clsx('flex h-7 min-w-0 items-center gap-2 rounded-md border border-border bg-clip-padding px-2 text-xs text-text-muted', HATCH)}
            data-band="paused"
        >
            <Icon icon={Pause} size={12} className="shrink-0 text-text-faint" />
            <span className="truncate">{skipped === 0 ? t('band.since', { since }) : t('band.skipped', { since, count: skipped })}</span>
            <button
                type="button"
                className="ml-auto shrink-0 font-medium text-accent hover:underline"
                onClick={() => setRoutinePaused(endpointId, entry, false)}
            >
                {t('actions.resume')}
            </button>
        </div>
    );
}

function Block({
    block,
    entry,
    timeZone,
    picked,
    onPick
}: {
    block: AgendaBlock;
    entry: RoutineEntry;
    timeZone: string;
    picked: boolean;
    onPick(picked: PickedRun): void;
}) {
    const { t } = useTranslation('routines');
    const time = formatClock(block.at, timeZone);
    const label = t('agenda.block', { title: entry.routine.title, time, state: t(`looks.${block.look}`) });
    const body = (
        <>
            <LookIcon look={block.look} />
            <span className="truncate tabular-nums">{blockWords(block, timeZone)}</span>
        </>
    );
    const className = clsx(
        'flex h-7 w-full min-w-0 items-center gap-1 px-1.5 text-xs',
        blockClass(block.look),
        picked && 'outline-2 outline-offset-1 outline-accent'
    );
    const run = block.run;
    if (run === null) {
        return (
            <span className={className} aria-label={label} data-look={block.look}>
                {body}
            </span>
        );
    }
    return (
        <button
            type="button"
            className={clsx(className, 'hover:brightness-110')}
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={picked}
            data-look={block.look}
            onClick={(event) => onPick({ entry, run, anchor: event.currentTarget })}
        >
            {body}
        </button>
    );
}

/* A day's quiet runs in one chip, whose popover lists each as the block it would have been. */
function FoldedRuns({
    item,
    entry,
    timeZone,
    pickedRunId,
    onPick
}: {
    item: Extract<CellItem, { kind: 'runs' }>;
    entry: RoutineEntry;
    timeZone: string;
    pickedRunId: string | null;
    onPick(picked: PickedRun): void;
}) {
    const { t } = useTranslation('routines');
    const [open, setOpen] = useState(false);
    const [chip, setChip] = useState<HTMLButtonElement | null>(null);
    const look = item.failed > 0 ? 'failed' : 'done';
    const words = foldWords(item, timeZone);
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <button
                ref={setChip}
                type="button"
                className={clsx('flex h-7 w-full min-w-0 items-center gap-1 px-1.5 text-xs hover:brightness-110', blockClass(look))}
                aria-label={t('agenda.folded', { title: entry.routine.title, runs: words })}
                aria-haspopup="dialog"
                aria-expanded={open}
                data-fold="runs"
                onClick={() => setOpen(!open)}
            >
                <LookIcon look={look} />
                <span className="truncate tabular-nums">{words}</span>
            </button>
            <Popover.Popup
                anchor={chip}
                className="flex max-h-80 w-56 flex-col gap-1 overflow-y-auto p-2"
                aria-label={t('agenda.foldedList', { title: entry.routine.title })}
            >
                {item.blocks.map((block) => (
                    <Block
                        key={block.key}
                        block={block}
                        entry={entry}
                        timeZone={timeZone}
                        picked={block.run !== null && block.run.runId === pickedRunId}
                        onPick={(picked) => {
                            setOpen(false);
                            onPick({ ...picked, anchor: chip ?? picked.anchor });
                        }}
                    />
                ))}
            </Popover.Popup>
        </Popover.Root>
    );
}

/* The rest of a day of a repeat within a day, as one outlined chip rather than a block per time. */
function ComingChip({ item, entry, timeZone }: { item: Extract<CellItem, { kind: 'coming' }>; entry: RoutineEntry; timeZone: string }) {
    const { t } = useTranslation('routines');
    const look = item.blocks[0]!.look;
    return (
        <span
            className={clsx('flex h-7 w-full min-w-0 items-center gap-1 px-1.5 text-xs', blockClass(look))}
            aria-label={t('agenda.coming', {
                title: entry.routine.title,
                count: item.blocks.length,
                from: formatClock(item.at, timeZone),
                times: foldWords(item, timeZone)
            })}
            data-look={look}
            data-fold="coming"
        >
            <LookIcon look={look} />
            <span className="truncate tabular-nums">{foldWords(item, timeZone)}</span>
        </span>
    );
}
