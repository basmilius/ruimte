import { useTranslation } from 'react-i18next';
import { CircleCheck } from 'lucide-react';
import type { RoutineEntry } from '@ruimte/contracts';
import { Button, FormError, Icon, ScrollArea, SectionLabel } from '@adecore/ui';
import { OutputProjectGlyph } from '@/output/look';
import { awaitingApproval, runsWaiting } from '@/routines/agenda';
import { showRoutine } from '@/routines/stage';
import { scheduleWords, weekdayClock } from '@/routines/words';
import { useRoutineApproval } from '@/routines/routine-approval';
import { useRoutineWhat } from '@/routines/routine-what';
import { endpointKey } from '@/state/keys';
import { useChats } from '@adecore/agents-react/state';

/*
 * The right column of the week, only while something waits on this machine, in any project: routines for
 * approval here, and runs waiting on a person. One of another project than `projectId` carries its badge.
 */
export function RoutineSide({
    endpointId,
    entries,
    projectId,
    timeZone
}: {
    endpointId: string;
    entries: RoutineEntry[];
    projectId: string | null;
    timeZone: string;
}) {
    const { t } = useTranslation('routines');
    const held = awaitingApproval(entries);
    const waiting = runsWaiting(entries);
    if (held.length === 0 && waiting.length === 0) {
        return null;
    }
    return (
        <ScrollArea render={<aside />} className="w-[248px] shrink-0 border-l border-border" viewportClassName="flex flex-col" aria-label={t('side.label')}>
            {held.length > 0 && (
                <section className="flex flex-col gap-2 border-b border-border p-3" aria-label={t('side.approvals')}>
                    <SideHeading label={t('side.approvals')} count={held.length} />
                    {held.map((entry) => (
                        <ApprovalCard
                            key={`${entry.projectId}:${entry.routine.id}`}
                            endpointId={endpointId}
                            entry={entry}
                            grouped={entry.projectId !== projectId}
                        />
                    ))}
                </section>
            )}
            {waiting.length > 0 && (
                <section className="flex flex-col gap-2 border-b border-border p-3" aria-label={t('side.needsYou')}>
                    <SideHeading label={t('side.needsYou')} count={waiting.length} />
                    {waiting.map(({ entry, run }) => (
                        <button
                            key={run.runId}
                            type="button"
                            className="flex items-start gap-2 rounded-md px-1 py-1 text-left hover:bg-surface-hover"
                            onClick={() => showRoutine({ projectId: entry.projectId, routineId: entry.routine.id }, run.runId)}
                        >
                            {entry.projectId !== projectId && <OutputProjectGlyph endpointId={endpointId} projectId={entry.projectId} />}
                            <span className="flex min-w-0 flex-col">
                                <span className="truncate text-sm text-text">{entry.routine.title}</span>
                                <WaitingFor endpointId={endpointId} chatId={run.chatId} since={weekdayClock(run.at, timeZone)} />
                            </span>
                        </button>
                    ))}
                </section>
            )}
        </ScrollArea>
    );
}

function SideHeading({ label, count }: { label: string; count: number }) {
    return (
        <SectionLabel render={<h3 />} className="flex items-center gap-2">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-status-needs-you" />
            {label}
            <span className="ml-auto tabular-nums">{count}</span>
        </SectionLabel>
    );
}

/*
 * What a waiting run asks, from the status of its chat that every client hears, since the routine's own
 * wire carries no question. Until that status is here it says since when the run waits.
 */
function WaitingFor({ endpointId, chatId, since }: { endpointId: string; chatId: string | undefined; since: string }) {
    const { t } = useTranslation('routines');
    const request = useChats((s) => (chatId === undefined ? undefined : s.statusByKey[endpointKey(endpointId, chatId)]?.info.requests?.[0]));
    const asked = request?.question?.questions[0]?.question ?? request?.approval?.subject;
    return <span className="line-clamp-2 text-xs break-words text-text-muted">{asked || t('side.waitsSince', { time: since })}</span>;
}

function ApprovalCard({ endpointId, entry, grouped }: { endpointId: string; entry: RoutineEntry; grouped: boolean }) {
    const { t } = useTranslation('routines');
    const what = useRoutineWhat(entry);
    const { origin, busy, failure, approve, decline } = useRoutineApproval(endpointId, entry);
    return (
        <article className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised bg-clip-padding p-3" aria-label={entry.routine.title}>
            <span className="flex min-w-0 items-center gap-2">
                {grouped && <OutputProjectGlyph endpointId={endpointId} projectId={entry.projectId} />}
                <span className="truncate text-sm font-medium text-text">{entry.routine.title}</span>
            </span>
            <span className="text-xs text-text-faint">{scheduleWords(entry.routine.schedule)}</span>
            <span className="text-xs text-text-muted">{origin}</span>
            <span className={`truncate text-xs text-text-muted ${entry.routine.kind === 'command' ? 'font-mono' : ''}`}>{what}</span>
            {failure !== null && <FormError className="break-words">{failure}</FormError>}
            <span className="mt-1 flex items-center justify-end gap-1.5">
                <Button size="sm" disabled={busy} onClick={decline}>
                    {t('approval.deny')}
                </Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={approve}>
                    <Icon icon={CircleCheck} size={14} />
                    {t('approval.approve')}
                </Button>
            </span>
        </article>
    );
}
