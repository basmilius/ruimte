import { Button, Icon, Popover } from '@adecore/ui';
import { formatClock } from '@adecore/ui/format';
import type { RoutineEntry, RoutineRun } from '@ruimte/contracts';
import { LayoutGrid, Pencil, Play, SquareArrowOutUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useArtifactText } from '@/output/artifact-bytes';
import { isTextMime } from '@/output/artifact-list';
import { useArtifact } from '@/output/use-artifact';
import { revealNode } from '@/project/views';
import { lookOfRun } from '@/routines/agenda';
import { openRoutineForm } from '@/routines/form-state';
import { LookIcon } from '@/routines/look';
import { runRoutineNow } from '@/routines/routine-commands';
import { dayWords, runWords } from '@/routines/words';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { showRoutine } from '@/state/routines-stage';
import { nodesOfView } from '@/state/view-nodes';
import { useMachineAnswers } from '@/transport/features';

// The lines of a result the card shows; the rest is a click away in Routines.
const RESULT_LINES = 6;

export interface PickedRun {
    entry: RoutineEntry;
    run: RoutineRun;
    anchor: HTMLElement;
}

/* The card a block of the week opens: what the run did, and where to go from it. */
export function RoutineRunPopover({
    endpointId,
    picked,
    timeZone,
    onClose
}: {
    endpointId: string;
    picked: PickedRun | null;
    timeZone: string;
    onClose(): void;
}) {
    const { t } = useTranslation('routines');
    return (
        <Popover.Root open={picked !== null} onOpenChange={(next) => !next && onClose()}>
            <Popover.Popup
                anchor={picked?.anchor}
                className="flex w-[360px] flex-col gap-3 p-3"
                aria-label={picked === null ? undefined : t('popover.label', { title: picked.entry.routine.title })}
            >
                {picked !== null && <RunCard endpointId={endpointId} entry={picked.entry} run={picked.run} timeZone={timeZone} onClose={onClose} />}
            </Popover.Popup>
        </Popover.Root>
    );
}

function RunCard({
    endpointId,
    entry,
    run,
    timeZone,
    onClose
}: {
    endpointId: string;
    entry: RoutineEntry;
    run: RoutineRun;
    timeZone: string;
    onClose(): void;
}) {
    const { t } = useTranslation('routines');
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const nodeId = useDocument((s) => {
        if (entry.projectId !== projectId) {
            return null;
        }
        for (const view of s.views) {
            const node = nodesOfView(view).find((candidate) => candidate.kind === 'routine' && candidate.routine === entry.routine.id);
            if (node !== undefined) {
                return node.id;
            }
        }
        return null;
    });
    const target = { projectId: entry.projectId, routineId: entry.routine.id };
    const artifactId = run.artifactId ?? entry.artifactId;
    const meta = [
        t('popover.started', { time: formatClock(run.at, timeZone) }),
        run.endedAt === undefined ? null : t(run.state === 'done' ? 'popover.done' : 'popover.ended', { time: formatClock(run.endedAt, timeZone) }),
        entry.projectName
    ].filter((part) => part !== null);
    const act = (action: () => void): void => {
        onClose();
        action();
    };
    return (
        <>
            <div className="flex min-w-0 flex-col gap-0.5">
                <Popover.Title className="flex min-w-0 items-center gap-2 text-sm font-medium text-text">
                    <LookIcon look={lookOfRun(run)} size={14} />
                    <span className="truncate">{t('popover.title', { title: entry.routine.title, date: dayWords(run.due, timeZone) })}</span>
                </Popover.Title>
                <span className="truncate text-xs text-text-faint">{meta.join(' · ')}</span>
            </div>
            {artifactId !== undefined && run.versionId !== undefined ? (
                <RunResult endpointId={endpointId} artifactId={artifactId} versionId={run.versionId} fallback={runWords(run, timeZone)} />
            ) : (
                <p className="text-xs break-words text-text-muted">{runWords(run, timeZone)}</p>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="primary" onClick={() => act(() => showRoutine(target, run.runId))}>
                    <Icon icon={SquareArrowOutUpRight} size={14} />
                    {t('node.openInRoutines')}
                </Button>
                <Button size="sm" variant="secondary" disabled={!entry.approved} onClick={() => act(() => void runRoutineNow(endpointId, entry))}>
                    <Icon icon={Play} size={14} />
                    {t('actions.runNow')}
                </Button>
                <Button size="sm" onClick={() => act(() => openRoutineForm({ projectId: entry.projectId, editing: entry }))}>
                    <Icon icon={Pencil} size={14} />
                    {t('actions.edit')}
                </Button>
                {nodeId !== null && (
                    <Button size="sm" onClick={() => act(() => revealNode(nodeId))}>
                        <Icon icon={LayoutGrid} size={14} />
                        {t('popover.openOnCanvas')}
                    </Button>
                )}
            </div>
        </>
    );
}

/* The first lines of the version the run delivered to Output, read the way the Output view reads it. */
function RunResult({ endpointId, artifactId, versionId, fallback }: { endpointId: string; artifactId: string; versionId: string; fallback: string }) {
    const { t } = useTranslation('routines');
    const answers = useMachineAnswers(endpointId, 'artifact.get');
    const artifact = useArtifact(endpointId, artifactId, answers);
    const version = artifact.status === 'ready' ? artifact.result.versions.find((candidate) => candidate.versionId === versionId) : undefined;
    const file = version?.files[0];
    const textual = file !== undefined && isTextMime(file.mime);
    const text = useArtifactText(endpointId, textual ? { artifactId, versionId, file: 0 } : null, textual ? file : null);
    const lines =
        text.status === 'ready'
            ? text.text
                  .split('\n')
                  .map((line) => line.trim())
                  .filter((line) => line !== '')
                  .slice(0, RESULT_LINES)
                  .join('\n')
            : '';
    return (
        <p className="line-clamp-6 rounded-lg bg-surface-sunken p-3 text-xs break-words whitespace-pre-wrap text-text select-text">
            {lines !== ''
                ? lines
                : version !== undefined && artifact.status === 'ready'
                  ? t('detail.versionOf', { title: artifact.result.artifact.title, number: version.number })
                  : fallback}
        </p>
    );
}
