import type { Routine } from '@ruimte/contracts';
import { refreshRoutines, useRoutineLists } from '@/routines/routine-list';
import { machineTransport } from '@/transport';

export function routineIdsTaken(endpointId: string, projectId: string): Set<string> {
    const list = useRoutineLists.getState().lists[endpointId];
    return new Set(
        list?.status === 'ready'
            ? list.result.routines.filter((entry) => entry.projectId === projectId).flatMap((entry) => [entry.routine.id, entry.routine.outputKey])
            : []
    );
}

/* A person's save of a routine, against the rev the list read. Resolves the id the machine saved it under. */
export async function saveRoutine(endpointId: string, projectId: string, routine: Routine, shared: boolean): Promise<string> {
    const list = useRoutineLists.getState().lists[endpointId];
    const baseRev = list?.status === 'ready' ? (list.result.revs[projectId] ?? 0) : 0;
    const result = await machineTransport(endpointId).request('routine.save', { projectId, baseRev, routine, shared });
    refreshRoutines(endpointId);
    return result.routineId;
}
