import { SlotMenuItems } from '@/extensions/SlotSurfaces';
import i18next from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, CircleAlert, Clock, Info, LayoutGrid, MoreHorizontal, Pause, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { isCanvasView, type RoutineEntry, type RoutineListResult } from '@ruimte/contracts';
import {
    Button,
    ButtonGroup,
    Dialog,
    EmptyState,
    ErrorBoundary,
    Icon,
    IconButton,
    Menu,
    PromptDialog,
    Segmented,
    Select,
    Separator,
    useNow
} from '@adecore/ui';
import { formatDateTime } from '@adecore/ui/format';
import { NOON_MS, weekOf, type AgendaWeek } from '@/routines/agenda';
import { openRoutineForm } from '@/routines/form-state';
import { AgendaLegend, RoutineAgenda, RoutineWeekList, type AgendaGroup } from '@/routines/RoutineAgenda';
import { RoutineDetail } from '@/routines/RoutineDetail';
import { runRoutineNow, setRoutinePaused, showRoutineOnCanvas } from '@/routines/routine-commands';
import { refreshRoutines, useRoutineList } from '@/routines/routine-list';
import { RoutineSide } from '@/routines/RoutineSide';
import { leaveRoutines, setRoutinesFilter, setRoutinesLayout, showRoutine, stepWeek, useRoutinesStage } from '@/routines/stage';
import { failed } from '@/shell/surface-failure';
import { useDocument } from '@/state/document';
import { useEndpoints } from '@/state/endpoints';
import { useEndpointId } from '@/state/keys';
import { isThisMachine } from '@/state/local-machine';
import { useProject } from '@/state/project';
import { machineTransport } from '@/transport';

const MINUTE_MS = 60_000;

/* Routines as a sheet over the workspace: the week of the project's routines, or one routine opened inside it. */
export function RoutinesStage() {
    const { t } = useTranslation('routines');
    const open = useRoutinesStage((s) => s.open);
    const endpointId = useEndpointId();
    const answers = useRoutineList(endpointId) !== null;
    const inProject = useProject((s) => s.current !== null);

    return (
        <Dialog.Root open={open && answers && inProject} onOpenChange={(next) => !next && leaveRoutines()}>
            <Dialog.Popup aria-label={t('stage.title')} className="flex h-[calc(100dvh-80px)] w-[calc(100vw-112px)] flex-col overflow-hidden">
                <ErrorBoundary label={failed('routines')} className="grow">
                    <StageBody endpointId={endpointId} />
                </ErrorBoundary>
            </Dialog.Popup>
        </Dialog.Root>
    );
}

function StageBody({ endpointId }: { endpointId: string }) {
    const { t } = useTranslation('routines');
    const list = useRoutineList(endpointId);
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const projectName = useProject((s) => s.current?.name ?? '');
    const stage = useRoutinesStage();

    if (list === null || projectId === null) {
        return null;
    }
    if (list.status !== 'ready') {
        return (
            <>
                <StageHeader title={t('stage.title')} />
                <div className="grid grow place-items-center">
                    {list.status === 'loading' ? (
                        <EmptyState busy>{t('stage.loading')}</EmptyState>
                    ) : (
                        <EmptyState icon={CircleAlert}>{t('stage.failed')}</EmptyState>
                    )}
                </div>
            </>
        );
    }
    const { result } = list;
    if (stage.routine !== null) {
        const entry = result.routines.find((candidate) => candidate.projectId === stage.routine?.projectId && candidate.routine.id === stage.routine.routineId);
        if (entry !== undefined) {
            return (
                <>
                    <DetailHeader endpointId={endpointId} entry={entry} rev={result.revs[entry.projectId] ?? 0} />
                    <RoutineDetail endpointId={endpointId} entry={entry} runId={stage.runId} timeZone={result.timeZone} />
                </>
            );
        }
    }
    return <WeekStage endpointId={endpointId} result={result} projectId={projectId} projectName={projectName} />;
}

/* Where in Routines this is, what can be done here, and Close at the far right. */
function StageHeader({ title, crumbs, children }: { title: string; crumbs?: React.ReactNode; children?: React.ReactNode }) {
    const { t } = useTranslation('routines');
    return (
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2 text-sm">
            <Icon icon={Clock} size={14} className="ml-1 text-text-muted" />
            {crumbs ?? <h2 className="font-medium text-text">{title}</h2>}
            {children}
            <Separator />
            <Button size="sm" onClick={leaveRoutines}>
                <Icon icon={X} size={14} />
                {t('stage.close')}
            </Button>
        </header>
    );
}

function WeekStage({ endpointId, result, projectId, projectName }: { endpointId: string; result: RoutineListResult; projectId: string; projectName: string }) {
    const { t } = useTranslation('routines');
    const offset = useRoutinesStage((s) => s.week);
    const filter = useRoutinesStage((s) => s.filter);
    const layout = useRoutinesStage((s) => s.layout);
    const now = useNow(MINUTE_MS);
    const week = weekOf(now, result.timeZone, offset);
    const grouped = filter === 'all';
    const shown = grouped ? result.routines : result.routines.filter((entry) => entry.projectId === projectId);
    const groups = groupsOf(shown, projectId, projectName);
    const machine = useEndpoints((s) => s.endpoints.find((candidate) => candidate.id === endpointId)?.label ?? '');
    // As the project switcher does: only another machine is named.
    const filterLabel = (projects: string): string => (isThisMachine(endpointId) ? projects : t('filter.on', { projects, machine }));

    return (
        <>
            <StageHeader title={t('stage.title')}>
                <Separator />
                <span className="truncate font-medium text-text">{rangeWords(week, result.timeZone)}</span>
                <span className="shrink-0 text-xs text-text-faint">{t('stage.week', { number: week.number })}</span>
                <IconButton icon={Info} size="sm" label={t('side.legend')} tooltip={<AgendaLegend />} />
                <span className="grow" />
                <ButtonGroup>
                    <IconButton icon={ChevronLeft} size="sm" label={t('stage.previousWeek')} onClick={() => stepWeek(-1)} />
                    <IconButton icon={ChevronRight} size="sm" label={t('stage.nextWeek')} onClick={() => stepWeek(1)} />
                </ButtonGroup>
                <Button size="sm" disabled={offset === 0} onClick={() => stepWeek(0)}>
                    {t('stage.today')}
                </Button>
                <Separator />
                <Segmented
                    label={t('layout.label')}
                    size="sm"
                    value={layout}
                    onValueChange={setRoutinesLayout}
                    options={[
                        { id: 'week', label: t('layout.week') },
                        { id: 'list', label: t('layout.list') }
                    ]}
                />
                <Select
                    size="sm"
                    label={t('filter.label')}
                    value={filter}
                    onValueChange={setRoutinesFilter}
                    items={[
                        { value: 'project', label: filterLabel(t('filter.thisProject')) },
                        { value: 'all', label: filterLabel(t('filter.all')) }
                    ]}
                />
                <Button size="sm" variant="primary" onClick={() => openRoutineForm({ projectId, pickProject: grouped })}>
                    <Icon icon={Plus} size={14} />
                    {t('actions.new')}
                </Button>
            </StageHeader>
            <div className="flex min-h-0 grow">
                {layout === 'list' ? (
                    <RoutineWeekList endpointId={endpointId} groups={groups} week={week} now={now} timeZone={result.timeZone} />
                ) : shown.length === 0 && !grouped ? (
                    <div className="relative flex min-w-0 grow flex-col">
                        <RoutineAgenda endpointId={endpointId} groups={[]} empty week={week} now={now} timeZone={result.timeZone} />
                        {/* Over the empty week, which shows through. */}
                        <div className="pointer-events-none absolute inset-x-0 top-14 bottom-0 grid place-items-center bg-surface/50 p-6">
                            <EmptyState icon={Clock} title={t('stage.emptyTitle')}>
                                {t('stage.empty')}
                            </EmptyState>
                        </div>
                    </div>
                ) : (
                    <RoutineAgenda endpointId={endpointId} groups={groups} week={week} now={now} timeZone={result.timeZone} />
                )}
                {/* Every project's, whatever the filter: the clock's dot counts them all, so this is where it is explained. */}
                <RoutineSide endpointId={endpointId} entries={result.routines} projectId={grouped ? null : projectId} timeZone={result.timeZone} />
            </div>
        </>
    );
}

/* `20 to 26 October`: the month once when both ends share it, the year only when the week crosses into another. */
function rangeWords(week: AgendaWeek, timeZone: string): string {
    const from = week.days[0]!.start + NOON_MS;
    const to = week.days[6]!.start + NOON_MS;
    const part = (at: number, options: Intl.DateTimeFormatOptions): string => formatDateTime(at, { ...options, timeZone });
    const sameYear = part(from, { year: 'numeric' }) === part(to, { year: 'numeric' });
    const fromDay = part(from, { day: 'numeric', month: 'long' });
    const toDay = part(to, sameYear ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' });
    if (part(from, { month: 'numeric' }) !== part(to, { month: 'numeric' })) {
        return i18next.t('routines:stage.range', { from: fromDay, to: toDay });
    }
    // The shared month is written once, on the side the region writes it: `20 to 26 October`, `October 20 to 26`.
    const dayFirst = toDay.startsWith(part(to, { day: 'numeric' }));
    return i18next.t('routines:stage.range', {
        from: dayFirst ? part(from, { day: 'numeric' }) : fromDay,
        to: dayFirst ? toDay : part(to, { day: 'numeric' })
    });
}

/* The open project first, then the others by name, each with its routines in the order the machine keeps them. */
function groupsOf(entries: readonly RoutineEntry[], projectId: string, projectName: string): AgendaGroup[] {
    const groups = new Map<string, AgendaGroup>();
    groups.set(projectId, { projectId, projectName, entries: [] });
    for (const entry of entries) {
        const group = groups.get(entry.projectId) ?? { projectId: entry.projectId, projectName: entry.projectName, entries: [] };
        group.entries.push(entry);
        groups.set(entry.projectId, group);
    }
    const [own, ...others] = [...groups.values()];
    return [own!, ...others.sort((left, right) => left.projectName.localeCompare(right.projectName))].filter((group) => group.entries.length > 0);
}

function DetailHeader({ endpointId, entry, rev }: { endpointId: string; entry: RoutineEntry; rev: number }) {
    const { t } = useTranslation('routines');
    const [removing, setRemoving] = useState(false);
    const paused = entry.local.pausedAt !== undefined;
    const target = { projectId: entry.projectId, routineId: entry.routine.id };
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const hasCanvas = useDocument((s) => s.views.some((view) => isCanvasView(view) && view.hidden !== true));
    const runNow = async (): Promise<void> => {
        const runId = await runRoutineNow(endpointId, entry);
        if (runId !== null) {
            showRoutine(target, runId);
        }
    };
    const remove = async (): Promise<void> => {
        await machineTransport(endpointId).request('routine.remove', { ...target, baseRev: rev });
        showRoutine(null);
        refreshRoutines(endpointId);
    };
    return (
        <StageHeader
            title={entry.routine.title}
            crumbs={
                <nav className="flex min-w-0 items-center gap-1.5" aria-label={t('stage.breadcrumb')}>
                    <button type="button" className="shrink-0 text-text-muted hover:text-text" onClick={() => showRoutine(null)}>
                        {t('stage.title')}
                    </button>
                    <span className="text-text-faint">/</span>
                    <h2 className="truncate font-medium text-text">{entry.routine.title}</h2>
                </nav>
            }
        >
            <span className="grow" />
            <Button size="sm" variant="primary" disabled={!entry.approved} onClick={() => void runNow()}>
                <Icon icon={Play} size={14} />
                {t('actions.runNow')}
            </Button>
            <Menu.Root>
                <IconButton icon={MoreHorizontal} size="sm" label={t('actions.more')} render={<Menu.Trigger />} />
                <Menu.Popup align="end">
                    <Menu.Item onClick={() => openRoutineForm({ projectId: entry.projectId, editing: entry })}>
                        <Icon icon={Pencil} size={14} /> {t('actions.edit')}
                    </Menu.Item>
                    <Menu.Separator />
                    <Menu.Item disabled={!entry.approved} onClick={() => setRoutinePaused(endpointId, entry, !paused)}>
                        <Icon icon={paused ? Play : Pause} size={14} /> {paused ? t('actions.resume') : t('actions.pause')}
                    </Menu.Item>
                    {hasCanvas && entry.projectId === projectId && (
                        <Menu.Item onClick={() => void showRoutineOnCanvas(entry)}>
                            <Icon icon={LayoutGrid} size={14} /> {t('detail.showOnCanvas')}
                        </Menu.Item>
                    )}
                    <Menu.Separator />
                    <Menu.Item className="text-status-error" onClick={() => setRemoving(true)}>
                        <Icon icon={Trash2} size={14} /> {t('actions.remove')}
                    </Menu.Item>
                    <SlotMenuItems kit={Menu} place="routineMenu" context={{ routine: { id: entry.routine.id } }} />
                </Menu.Popup>
            </Menu.Root>
            <PromptDialog
                open={removing}
                title={t('remove.title', { title: entry.routine.title })}
                description={t('remove.description')}
                confirmLabel={t('remove.confirm')}
                confirmIcon={Trash2}
                danger
                fallbackMessage={t('remove.failed')}
                onConfirm={remove}
                onOpenChange={() => setRemoving(false)}
            />
        </StageHeader>
    );
}
