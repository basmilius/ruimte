import { RUNTIME_MODES, runtimeModeLabel, type Referables } from '@adecore/agents-react/chat';
import { ModelPicker, PromptEditor } from '@adecore/agents-react/chat/ui';
import { Button, Checkbox, Field, FieldHint, FormError, Icon, Input, Segmented, Select, messageOf } from '@adecore/ui';
import { localTimeZone } from '@adecore/ui/format';
import { nextDue, parseCron, type Routine, type RoutineKind, type RoutinePerRun, type RoutineSchedule, type RuntimeMode } from '@ruimte/contracts';
import { Package } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useReferables } from '@/chat/referables';
import { weekdayWords } from '@/format/weekday';
import { useLaunches } from '@/launches/state';
import { freshRoutineId } from '@/routines/agenda';
import { firstLine, useAgentPick, type AgentPick } from '@/routines/agent-pick';
import type { RoutineFormRequest } from '@/routines/form-state';
import { promptDraftOf, routinePicked } from '@/routines/prompt-picks';
import { useRoutineSkills } from '@/routines/prompt-skills';
import { useRoutineLists } from '@/routines/routine-list';
import { routineIdsTaken, saveRoutine } from '@/routines/routine-save';
import { cronProblemWords, dayClockWords, everyWords } from '@/routines/words';
import { endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { useProjectList } from '@/state/project-list';

const DAYS = [1, 2, 3, 4, 5, 6, 7];

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

// The steps the form offers; a routine an agent set to another step keeps it as an extra choice.
const STEPS = [15, 30, 60, 120, 180, 240];

const NEXT_SHOWN = 3;

const NO_REFERABLES: Referables = { items: [], chatsOnly: false };

/* The next few times an expression runs after `from`, so a person sees what the fields mean. */
function nextTimes(expression: string, from: number, timeZone: string): number[] {
    const times: number[] = [];
    let cursor: number | null = from;
    while (times.length < NEXT_SHOWN) {
        cursor = nextDue({ kind: 'cron', expression }, cursor, timeZone);
        if (cursor === null) {
            break;
        }
        times.push(cursor);
    }
    return times;
}

function today(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/*
 * The one form a routine is made and changed in, in its dialog. Saving is a person's save on the machine,
 * which approves what it writes.
 */
export function RoutineForm({
    endpointId,
    request,
    onDone,
    onCancel
}: {
    endpointId: string;
    request: RoutineFormRequest;
    onDone(projectId: string, routineId: string): void;
    onCancel(): void;
}) {
    const { t } = useTranslation('routines');
    const editing = request.editing?.routine;
    const allProjects = useProjectList((s) => s.projects);
    // The project the form was opened from leads, the rest keep their order.
    const projects = allProjects
        .filter((row) => row.endpointId === endpointId)
        .sort((left, right) => Number(right.summary.projectId === request.projectId) - Number(left.summary.projectId === request.projectId));
    const [projectId, setProjectId] = useState(request.projectId);
    const [title, setTitle] = useState(editing?.title ?? '');
    const [kind, setKind] = useState<RoutineKind>(editing?.kind ?? 'agent');
    const [promptDraft, setPromptDraft] = useState(() =>
        editing?.kind === 'agent' ? promptDraftOf(editing.prompt, editing.picked) : promptDraftOf(request.prompt ?? '', undefined)
    );
    const prompt = promptDraft.text;
    const [pick, setPick] = useState<AgentPick | null>(
        editing?.kind === 'agent' ? { provider: editing.provider, selection: editing.selection } : (request.agent ?? null)
    );
    const [mode, setMode] = useState<RuntimeMode>(editing?.kind === 'agent' ? editing.mode : 'supervised');
    const [perRun, setPerRun] = useState<RoutinePerRun>(editing?.kind === 'agent' ? editing.perRun : 'new');
    const [command, setCommand] = useState(editing?.kind === 'command' ? editing.command : '');
    const [cwd, setCwd] = useState(editing?.kind === 'command' ? (editing.cwd ?? '') : '');
    const [launchId, setLaunchId] = useState<string | null>(editing?.kind === 'launch' ? editing.launchId : null);
    const schedule: RoutineSchedule = editing?.schedule ?? { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' };
    const [repeat, setRepeat] = useState<RoutineSchedule['kind']>(schedule.kind);
    const [date, setDate] = useState(schedule.kind === 'once' ? schedule.date : today());
    const [days, setDays] = useState<number[]>(schedule.kind === 'once' || schedule.kind === 'cron' ? [1, 2, 3, 4, 5] : schedule.days);
    const [time, setTime] = useState(schedule.kind === 'interval' ? schedule.from : schedule.kind === 'cron' ? '09:00' : schedule.time);
    const [expression, setExpression] = useState(schedule.kind === 'cron' ? schedule.expression : '0 9 * * 1-5');
    // The moment the next runs of a cron are counted from; the form is open for minutes at most.
    const [openedAt] = useState(() => Date.now());
    const [every, setEvery] = useState(schedule.kind === 'interval' ? schedule.every : 60);
    const [until, setUntil] = useState(schedule.kind === 'interval' ? schedule.to : '17:00');
    const [shared, setShared] = useState(request.editing?.shared ?? false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const machineTimeZone = useRoutineLists((s) => {
        const list = s.lists[endpointId];
        return list?.status === 'ready' ? list.result.timeZone : null;
    });
    const launches = useLaunches((s) => s.documents[endpointKey(endpointId, projectId)]?.launches ?? null);
    const { pickable, provider, selection } = useAgentPick(pick);
    const providerInfo = pickable.find((entry) => entry.kind === provider);
    const skills = useRoutineSkills(endpointId, projectId, kind === 'agent' ? provider : null);
    const openProjectId = useProject((s) => s.current?.projectId ?? null);
    const openReferables = useReferables(endpointId, '');
    // `#` reaches the views of the project open here; another project's views this window does not know.
    const referables = openProjectId === projectId ? openReferables : null;
    const folder = projects.find((row) => row.summary.projectId === projectId)?.summary.folder ?? null;
    const shownTitle = title.trim() !== '' ? title.trim() : kind === 'agent' ? firstLine(prompt) : kind === 'command' ? firstLine(command) : '';
    const cron = parseCron(expression);
    const timeZone = machineTimeZone ?? localTimeZone() ?? 'UTC';

    const scheduleReady =
        repeat === 'cron'
            ? cron.ok
            : CLOCK.test(time) &&
              (repeat === 'once' ? /^\d{4}-\d{2}-\d{2}$/.test(date) : days.length > 0) &&
              (repeat !== 'interval' || (CLOCK.test(until) && until > time));
    const ready =
        shownTitle !== '' &&
        scheduleReady &&
        (kind === 'agent' ? prompt.trim() !== '' && provider !== null : kind === 'command' ? command.trim() !== '' : launchId !== null);

    const scheduleOf = (): RoutineSchedule => {
        const sorted = [...days].sort();
        if (repeat === 'once') {
            return { kind: 'once', date, time };
        }
        if (repeat === 'cron') {
            return { kind: 'cron', expression: expression.trim().split(/\s+/).join(' ') };
        }
        return repeat === 'interval' ? { kind: 'interval', days: sorted, every, from: time, to: until } : { kind: 'weekly', days: sorted, time };
    };

    const build = (): Routine => {
        const id = editing?.id ?? freshRoutineId(shownTitle, routineIdsTaken(endpointId, projectId));
        const base = {
            id,
            title: shownTitle,
            schedule: scheduleOf(),
            outputKey: editing?.outputKey ?? id
        };
        // What a newer release stored on the routine rides along unchanged.
        const kept = editing?.kind === kind ? editing : {};
        if (kind === 'agent') {
            const picked = routinePicked(promptDraft, referables);
            const routine: Routine = {
                ...kept,
                ...base,
                kind,
                prompt: prompt.trim(),
                provider: provider!,
                ...(selection === undefined ? {} : { selection }),
                mode,
                perRun,
                picked
            };
            // Absent rather than empty, so a routine without picks keeps the approval it had.
            if (picked === undefined) {
                delete routine.picked;
            }
            return routine;
        }
        if (kind === 'command') {
            return { ...kept, ...base, kind, command: command.trim(), ...(cwd.trim() === '' ? {} : { cwd: cwd.trim() }) };
        }
        return { ...kept, ...base, kind, launchId: launchId! };
    };

    const submit = async (event?: FormEvent): Promise<void> => {
        event?.preventDefault();
        if (!ready || busy) {
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            onDone(projectId, await saveRoutine(endpointId, projectId, build(), shared));
        } catch (e) {
            setFailure(messageOf(e, t('form.failed')));
            setBusy(false);
        }
    };

    return (
        <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)} aria-label={editing ? t('form.editTitle') : t('form.newTitle')}>
            <Field label={t('form.title')}>
                <Input value={title} placeholder={shownTitle === '' ? t('form.titlePlaceholder') : shownTitle} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            {request.pickProject === true && projects.length > 1 && (
                <Field label={t('form.project')} group>
                    <Select
                        label={t('form.project')}
                        value={projectId}
                        onValueChange={setProjectId}
                        items={projects.map((row) => ({ value: row.summary.projectId, label: row.summary.name }))}
                    />
                </Field>
            )}
            <Segmented
                label={t('form.kind')}
                size="sm"
                value={kind}
                onValueChange={(id) => setKind(id as RoutineKind)}
                options={[
                    { id: 'agent', label: t('kinds.agent') },
                    { id: 'command', label: t('kinds.command') },
                    { id: 'launch', label: t('kinds.launch') }
                ]}
            />
            {kind === 'agent' && (
                <>
                    {pickable.length === 0 ? (
                        <FieldHint>{t('form.noAgent')}</FieldHint>
                    ) : (
                        provider !== null &&
                        selection !== undefined && (
                            <Field label={t('form.agent')} group>
                                <div>
                                    <ModelPicker
                                        providers={pickable}
                                        provider={provider}
                                        selection={selection}
                                        open={pickerOpen}
                                        onOpenChange={setPickerOpen}
                                        onChange={(next, model) => setPick({ provider: next, selection: { model, options: {} } })}
                                        kbd={null}
                                        side="bottom"
                                        trigger="chip"
                                        chipSize="md"
                                    />
                                </div>
                            </Field>
                        )
                    )}
                    <Field label={t('form.prompt')} group hint={t('form.promptHint')}>
                        <PromptEditor
                            value={promptDraft}
                            onChange={setPromptDraft}
                            label={t('form.prompt')}
                            placeholder={t('form.promptPlaceholder')}
                            skills={skills}
                            slashCommands={skills.map((skill) => skill.name)}
                            goals={providerInfo?.capabilities.goals !== undefined}
                            cwd={providerInfo?.capabilities.mentions === false ? null : folder}
                            referables={referables ?? NO_REFERABLES}
                            providerName={providerInfo?.name}
                        />
                    </Field>
                    <Field label={t('form.mode')} group>
                        <Select
                            label={t('form.mode')}
                            value={mode}
                            onValueChange={(value) => setMode(value as RuntimeMode)}
                            items={RUNTIME_MODES.map((entry) => ({ value: entry, label: runtimeModeLabel(entry) }))}
                        />
                    </Field>
                    <Field label={t('form.perRun')} group>
                        <Segmented
                            label={t('form.perRun')}
                            size="sm"
                            value={perRun}
                            onValueChange={(id) => setPerRun(id as RoutinePerRun)}
                            options={[
                                { id: 'new', label: t('perRun.new') },
                                { id: 'continue', label: t('perRun.continue') }
                            ]}
                        />
                    </Field>
                </>
            )}
            {kind === 'command' && (
                <>
                    <Field label={t('form.command')}>
                        <Input mono value={command} spellCheck={false} onChange={(e) => setCommand(e.target.value)} />
                    </Field>
                    <Field label={t('form.folder')} hint={t('form.folderHint')}>
                        <Input mono value={cwd} spellCheck={false} placeholder="." onChange={(e) => setCwd(e.target.value)} />
                    </Field>
                </>
            )}
            {kind === 'launch' && (
                <Field label={t('form.launch')} group hint={launches === null || launches.length === 0 ? t('form.noLaunches') : undefined}>
                    <Select
                        label={t('form.launch')}
                        value={launchId}
                        placeholder={t('form.launchPlaceholder')}
                        disabled={launches === null || launches.length === 0}
                        onValueChange={setLaunchId}
                        items={(launches ?? []).map((launch) => ({ value: launch.id, label: launch.name }))}
                    />
                </Field>
            )}
            <Field label={t('form.repeat')} group>
                <div className="flex flex-col gap-2">
                    <Segmented
                        label={t('form.repeat')}
                        size="sm"
                        value={repeat}
                        onValueChange={(id) => setRepeat(id as RoutineSchedule['kind'])}
                        options={[
                            { id: 'once', label: t('form.once') },
                            { id: 'weekly', label: t('form.weekly') },
                            { id: 'interval', label: t('form.interval') },
                            { id: 'cron', label: t('form.cron') }
                        ]}
                    />
                    {repeat === 'cron' ? (
                        <Field
                            label={t('form.cronExpression')}
                            hint={cron.ok ? t('form.cronHint') : undefined}
                            error={cron.ok ? undefined : cronProblemWords(cron.problem)}
                        >
                            <Input
                                mono
                                size="sm"
                                value={expression}
                                spellCheck={false}
                                placeholder="0 9 * * 1-5"
                                onChange={(e) => setExpression(e.target.value)}
                            />
                        </Field>
                    ) : repeat === 'once' ? (
                        <Input type="date" size="sm" aria-label={t('form.date')} value={date} onChange={(e) => setDate(e.target.value)} />
                    ) : (
                        <div className="flex flex-wrap gap-1" role="group" aria-label={t('form.days')}>
                            {DAYS.map((day) => {
                                const on = days.includes(day);
                                return (
                                    <Button
                                        key={day}
                                        size="xs"
                                        variant={on ? 'secondary' : 'ghost'}
                                        aria-pressed={on}
                                        onClick={() => setDays(on ? days.filter((entry) => entry !== day) : [...days, day])}
                                    >
                                        {weekdayWords(day)}
                                    </Button>
                                );
                            })}
                        </div>
                    )}
                    {repeat === 'cron' ? (
                        cron.ok && (
                            <p className="text-xs text-text-muted tabular-nums" data-cron-next>
                                {t('form.cronNext', {
                                    times: nextTimes(expression, openedAt, timeZone)
                                        .map((at) => dayClockWords(at, timeZone))
                                        .join(', ')
                                })}
                            </p>
                        )
                    ) : repeat === 'interval' ? (
                        <div className="flex flex-wrap items-center gap-2">
                            <Select
                                label={t('form.every')}
                                size="sm"
                                value={String(every)}
                                onValueChange={(value) => setEvery(Number(value))}
                                items={[...new Set([...STEPS, every])]
                                    .sort((left, right) => left - right)
                                    .map((minutes) => ({ value: String(minutes), label: everyWords(minutes) }))}
                            />
                            <span className="text-xs text-text-muted">{t('form.from')}</span>
                            <Input
                                type="time"
                                size="sm"
                                className="w-28"
                                aria-label={t('form.fromTime')}
                                value={time}
                                onChange={(e) => setTime(e.target.value)}
                            />
                            <span className="text-xs text-text-muted">{t('form.to')}</span>
                            <Input
                                type="time"
                                size="sm"
                                className="w-28"
                                aria-label={t('form.toTime')}
                                value={until}
                                onChange={(e) => setUntil(e.target.value)}
                            />
                            <span className="text-xs text-text-muted">{t('form.machineClock')}</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <Input type="time" size="sm" className="w-28" aria-label={t('form.time')} value={time} onChange={(e) => setTime(e.target.value)} />
                            <span className="text-xs text-text-muted">{t('form.machineClock')}</span>
                        </div>
                    )}
                </div>
            </Field>
            <label className="flex items-start gap-2 text-sm text-text">
                <Checkbox className="mt-0.5" checked={shared} onCheckedChange={setShared} label={t('form.shared')} />
                <span className="flex flex-col">
                    <span>{t('form.shared')}</span>
                    <span className="text-xs text-text-muted">{t('form.sharedHint')}</span>
                </span>
            </label>
            <p className="flex items-start gap-2 text-xs text-text-muted">
                <Icon icon={Package} size={14} className="mt-0.5 shrink-0" />
                <span>{t(kind === 'agent' ? 'form.outputAgent' : 'form.outputPrinted')}</span>
            </p>
            {failure !== null && <FormError className="break-words">{failure}</FormError>}
            <div className="flex items-center justify-end gap-2">
                <Button onClick={onCancel}>{t('common:action.cancel')}</Button>
                <Button type="submit" variant="primary" disabled={!ready || busy}>
                    {editing ? t('form.save') : t('form.create')}
                </Button>
            </div>
        </form>
    );
}
