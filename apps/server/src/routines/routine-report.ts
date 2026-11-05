import type { RoutineListResult } from '@ruimte/contracts';
import { field } from '../canvas/host.ts';
import { approvalOf, runStateOf, scheduleText } from '../tools/routine-tools.ts';

// The newest runs a read prints; the stage and `routine_list` reach the rest.
export const REPORTED_RUNS = 10;

/*
 * What `read` of a routine node gives an agent: the routine's definition as `routine_list` words it,
 * then its newest runs. Only a routine of the reader's own project; any other reads as not there.
 */
export async function routineReport(
    routines: { list(projectId: string): Promise<RoutineListResult> },
    projectId: string,
    routineId: string
): Promise<string | null> {
    const { routines: entries, timeZone } = await routines.list(projectId);
    const entry = entries.find((candidate) => candidate.routine.id === routineId);
    if (entry === undefined) {
        return null;
    }
    const { routine } = entry;
    const what =
        routine.kind === 'agent'
            ? `agent\t${routine.provider}\t${routine.selection?.model ?? '-'}\t${routine.mode}\t${routine.perRun}`
            : routine.kind === 'command'
              ? `command\t${field(routine.command)}\t${routine.cwd ?? '.'}`
              : `launch\t${routine.launchId}`;
    const runs = entry.runs
        .slice(0, REPORTED_RUNS)
        .map((run) =>
            [
                'run',
                run.runId,
                run.kind,
                runStateOf(run),
                new Date(run.due).toISOString(),
                run.versionNumber === undefined ? '-' : `v${run.versionNumber}`,
                run.error === undefined ? '-' : field(run.error)
            ].join('\t')
        );
    return [
        `routine\t${routine.id}\t${field(routine.title)}\t${routine.kind}\t${entry.shared ? 'shared' : 'private'}`,
        `schedule\t${scheduleText(routine.schedule)}\t${timeZone}`,
        `approved\t${approvalOf(entry)}`,
        `paused\t${entry.local.pausedAt === undefined ? 'no' : 'yes'}`,
        `next\t${entry.next === null ? '-' : new Date(entry.next).toISOString()}`,
        what,
        `output\t${routine.outputKey}\t${entry.artifactId ?? '-'}`,
        ...(runs.length === 0 ? ['note\tIt has not run yet'] : runs),
        ...(entry.runs.length > REPORTED_RUNS ? [`note\t${entry.runs.length - REPORTED_RUNS} older runs are not printed`] : []),
        ...(routine.kind === 'agent' ? ['', routine.prompt] : [])
    ].join('\n');
}
