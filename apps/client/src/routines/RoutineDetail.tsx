import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, CircleCheck, Hand, SquareArrowOutUpRight } from 'lucide-react';
import type { RoutineEntry, RoutineRun } from '@ruimte/contracts';
import { Button, EmptyState, ErrorBoundary, FormError, Icon, IconButton, KeyValueList, Pill, SectionLabel, Segmented } from '@adecore/ui';
import { formatDateTime } from '@adecore/ui/format';
import { runtimeModeLabel } from '@adecore/agents-react/chat';
import { ArtifactView } from '@/output/ArtifactView';
import { ArtifactOpenerContext } from '@/output/artifact-opener';
import { openArtifact } from '@/output/open';
import { FileToolbarSlotProvider, fixedSlot } from '@/shell/panels/file-toolbar-slot';
import { lookOfRun } from '@/routines/agenda';
import { LookIcon } from '@/routines/look';
import { AgentModelLabel } from '@adecore/agents-react/providers';
import { RoutineRunChat } from '@/routines/RoutineRunChat';
import { useRoutineApproval } from '@/routines/routine-approval';
import { useRoutineWhat } from '@/routines/routine-what';
import { RoutinePrompt } from '@/routines/RoutinePrompt';
import { leaveRoutines, showRoutine } from '@/routines/stage';
import { dayClockWords, dayWords, runWords, scheduleWords, weekdayClock } from '@/routines/words';
import { useEndpoints } from '@/state/endpoints';
import { isThisMachine } from '@/state/local-machine';

/* A routine opened inside Routines: its definition and runs on the left, the run picked on the right. */
export function RoutineDetail({ endpointId, entry, runId, timeZone }: { endpointId: string; entry: RoutineEntry; runId: string | null; timeZone: string }) {
    const { t } = useTranslation('routines');
    const run = entry.runs.find((candidate) => candidate.runId === runId) ?? entry.runs.find((candidate) => candidate.state !== 'skipped') ?? null;
    return (
        <div className="flex min-h-0 grow">
            <div className="flex w-[440px] shrink-0 flex-col overflow-y-auto border-r border-border">
                <Definition endpointId={endpointId} entry={entry} />
                <RunTimeline entry={entry} picked={run?.runId ?? null} timeZone={timeZone} />
            </div>
            <div className="flex min-w-0 grow flex-col">
                <ErrorBoundary label={t('detail.runFailed')} resetKeys={[run?.runId ?? null]} className="grow">
                    {run === null ? (
                        <div className="grid grow place-items-center">
                            <NoRunYet entry={entry} timeZone={timeZone} />
                        </div>
                    ) : (
                        <RunPane key={run.runId} entry={entry} run={run} timeZone={timeZone} />
                    )}
                </ErrorBoundary>
            </div>
        </div>
    );
}

function NoRunYet({ entry, timeZone }: { entry: RoutineEntry; timeZone: string }) {
    const { t } = useTranslation('routines');
    return <EmptyState>{entry.next === null ? t('detail.noRuns') : t('detail.firstRun', { time: weekdayClock(entry.next, timeZone) })}</EmptyState>;
}

function Definition({ endpointId, entry }: { endpointId: string; entry: RoutineEntry }) {
    const { t } = useTranslation('routines');
    const routine = entry.routine;
    const what = useRoutineWhat(entry);
    const machine = useEndpoints((s) => s.endpoints.find((candidate) => candidate.id === endpointId)?.label ?? '');
    return (
        <section className="flex flex-col gap-3 border-b border-border p-4" aria-label={t('detail.definition')}>
            {(entry.held !== undefined || entry.local.declined === entry.digest) && <ApprovalBanner endpointId={endpointId} entry={entry} />}
            {routine.kind === 'agent' && (
                <div className="flex flex-col gap-1.5">
                    <SectionLabel render={<h3 />}>{t('detail.instructions')}</SectionLabel>
                    <div className="text-text select-text">
                        <RoutinePrompt endpointId={endpointId} entry={entry} />
                    </div>
                </div>
            )}
            {routine.kind === 'command' && (
                <div className="flex flex-col gap-1.5">
                    <SectionLabel render={<h3 />}>{t('form.command')}</SectionLabel>
                    <p className="font-mono text-code whitespace-pre-wrap text-text select-text">{routine.command}</p>
                </div>
            )}
            <KeyValueList.Root>
                <KeyValueList.Item>
                    <KeyValueList.Name>{t('detail.repeat')}</KeyValueList.Name>
                    <KeyValueList.Value>{scheduleWords(routine.schedule)}</KeyValueList.Value>
                </KeyValueList.Item>
                <KeyValueList.Item>
                    <KeyValueList.Name>{t(`detail.what.${routine.kind}`)}</KeyValueList.Name>
                    <KeyValueList.Value mono={routine.kind !== 'agent'}>
                        {routine.kind === 'agent' ? (
                            <AgentModelLabel scopeId={endpointId} provider={routine.provider} model={routine.selection?.model} />
                        ) : routine.kind === 'command' ? (
                            (routine.cwd ?? '.')
                        ) : (
                            what
                        )}
                    </KeyValueList.Value>
                </KeyValueList.Item>
                {routine.kind === 'agent' && (
                    <>
                        <KeyValueList.Item>
                            <KeyValueList.Name>{t('detail.mode')}</KeyValueList.Name>
                            <KeyValueList.Value>{runtimeModeLabel(routine.mode)}</KeyValueList.Value>
                        </KeyValueList.Item>
                        <KeyValueList.Item>
                            <KeyValueList.Name>{t('detail.account')}</KeyValueList.Name>
                            <KeyValueList.Value>{entry.local.account ?? t('detail.defaultAccount')}</KeyValueList.Value>
                        </KeyValueList.Item>
                    </>
                )}
                <KeyValueList.Item>
                    <KeyValueList.Name>{t('detail.runsOn')}</KeyValueList.Name>
                    <KeyValueList.Value>{isThisMachine(endpointId) ? t('detail.thisMachine') : machine}</KeyValueList.Value>
                </KeyValueList.Item>
                <KeyValueList.Item>
                    <KeyValueList.Name>{t('detail.kept')}</KeyValueList.Name>
                    <KeyValueList.Value>{entry.shared ? t('detail.shared') : t('detail.private')}</KeyValueList.Value>
                </KeyValueList.Item>
            </KeyValueList.Root>
        </section>
    );
}

function RunTimeline({ entry, picked, timeZone }: { entry: RoutineEntry; picked: string | null; timeZone: string }) {
    const { t } = useTranslation('routines');
    const target = { projectId: entry.projectId, routineId: entry.routine.id };
    return (
        <section className="flex flex-col gap-1 p-3" aria-label={t('detail.runs')}>
            <SectionLabel render={<h3 />} className="flex items-center px-1 pb-1">
                {t('detail.runs')}
                <span className="ml-auto tabular-nums">{entry.runs.length}</span>
            </SectionLabel>
            {entry.next !== null && (
                <div className="flex items-start gap-2 rounded-md px-2 py-1.5">
                    <LookIcon look="next" />
                    <span className="flex min-w-0 grow flex-col">
                        <span className="text-sm text-text">{dayClockWords(entry.next, timeZone)}</span>
                        <span className="text-xs text-text-muted">{entry.local.pausedAt === undefined ? t('detail.nextRun') : t('row.paused')}</span>
                    </span>
                    <Pill>{t('looks.next')}</Pill>
                </div>
            )}
            {entry.runs.length === 0 && <p className="px-2 text-xs text-text-muted">{t('detail.noRunsYet')}</p>}
            {entry.runs.map((run) => (
                <button
                    key={run.runId}
                    type="button"
                    aria-current={run.runId === picked ? 'true' : undefined}
                    className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover ${run.runId === picked ? 'bg-surface-active' : ''}`}
                    onClick={() => showRoutine(target, run.runId)}
                >
                    <span className="mt-1">
                        <LookIcon look={lookOfRun(run)} />
                    </span>
                    <span className="flex min-w-0 grow flex-col">
                        <span className="text-sm text-text">
                            {dayWords(run.due, timeZone)}{' '}
                            <span className="text-text-faint">{formatDateTime(run.at, { hour: '2-digit', minute: '2-digit', timeZone })}</span>
                        </span>
                        <span className="text-xs break-words text-text-muted">{runWords(run, timeZone)}</span>
                    </span>
                    {run.versionNumber !== undefined && <Pill>{t('detail.version', { number: run.versionNumber })}</Pill>}
                </button>
            ))}
        </section>
    );
}

function RunPane({ entry, run, timeZone }: { entry: RoutineEntry; run: RoutineRun; timeZone: string }) {
    const { t } = useTranslation('routines');
    const artifactId = run.artifactId ?? entry.artifactId;
    const version = artifactId !== undefined && run.versionId !== undefined ? { artifactId, versionId: run.versionId } : null;
    const [shown, setShown] = useState<'chat' | 'output'>(run.chatId !== undefined ? 'chat' : 'output');
    const [pinned, setPinned] = useState<string | null>(null);
    // The version's own controls (versions, compare, info) land in this bar rather than in a second one under it.
    const [slot, setSlot] = useState<HTMLElement | null>(null);
    const open = (): void => {
        if (version !== null) {
            leaveRoutines();
            openArtifact(version.artifactId, entry.routine.title, pinned ?? version.versionId);
        }
    };
    // A version the run's chat saved opens in this run's Output tab; any other artifact leaves for Output.
    const openHere = (artifactId: string, title: string, versionId: string | null, clicked: string): void => {
        if (version !== null && artifactId === version.artifactId) {
            setPinned(clicked === version.versionId ? null : clicked);
            setShown('output');
            return;
        }
        leaveRoutines();
        openArtifact(artifactId, title, versionId);
    };
    return (
        <div className="flex min-h-0 grow flex-col">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-soft px-3 text-xs text-text-muted">
                <span className="min-w-0 truncate">{t('detail.runAt', { time: dayClockWords(run.at, timeZone) })}</span>
                <span className="grow" />
                {version !== null && shown === 'output' && <span ref={setSlot} className="flex shrink-0 items-center gap-1" />}
                {version !== null && run.chatId !== undefined && (
                    <Segmented
                        label={t('detail.show')}
                        size="sm"
                        value={shown}
                        onValueChange={(id) => setShown(id === 'output' ? 'output' : 'chat')}
                        options={[
                            { id: 'chat', label: t('detail.chat') },
                            { id: 'output', label: t('detail.output') }
                        ]}
                    />
                )}
                {version !== null && <IconButton icon={SquareArrowOutUpRight} size="sm" label={t('detail.openInOutput')} onClick={open} />}
            </div>
            {version !== null && shown === 'output' ? (
                <FileToolbarSlotProvider value={fixedSlot(slot)}>
                    <div className="flex min-h-0 grow flex-col">
                        <ArtifactView artifactId={version.artifactId} pin={{ version: pinned ?? version.versionId, set: setPinned }} inItsRoutine />
                    </div>
                </FileToolbarSlotProvider>
            ) : run.chatId !== undefined ? (
                <ArtifactOpenerContext value={openHere}>
                    <RoutineRunChat chatId={run.chatId} revision={`${run.state}:${run.endedAt ?? ''}`} />
                </ArtifactOpenerContext>
            ) : (
                <div className="grid grow place-items-center">
                    <EmptyState>{runWords(run, timeZone)}</EmptyState>
                </div>
            )}
        </div>
    );
}

/* Over a routine that waits for this person's yes: it runs here only once approved as it stands. */
function ApprovalBanner({ endpointId, entry }: { endpointId: string; entry: RoutineEntry }) {
    const { t } = useTranslation('routines');
    const { origin, busy, failure, approve, decline } = useRoutineApproval(endpointId, entry);
    // A denial stands until the routine changes; approving it here is the way back.
    const declined = entry.local.declined === entry.digest;
    return (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised bg-clip-padding p-3" role="status">
            <span className="flex items-center gap-2 text-sm font-medium text-text">
                <Icon icon={declined ? Ban : Hand} size={14} className={declined ? 'text-text-muted' : 'text-status-needs-you'} />
                {t(declined ? 'row.declined' : 'row.held')}
            </span>
            <span className="text-xs text-text-muted">{origin}</span>
            {failure !== null && <FormError className="break-words">{failure}</FormError>}
            <span className="flex items-center justify-end gap-1.5">
                {!declined && (
                    <Button size="sm" disabled={busy} onClick={decline}>
                        {t('approval.deny')}
                    </Button>
                )}
                <Button size="sm" variant="secondary" disabled={busy} onClick={approve}>
                    <Icon icon={CircleCheck} size={14} />
                    {t('approval.approve')}
                </Button>
            </span>
        </div>
    );
}
