import type { RoutineAgentHost } from '../tools/host.ts';
import type { Routines } from './routines.ts';

/*
 * The routines as the tools reach them. Every save goes through `saveByAgent`, which never approves,
 * and names the calling chat as its maker, so no tool can save a routine as a person.
 */
export function agentRoutines(
    routines: Pick<Routines, 'list' | 'saveByAgent' | 'pause' | 'resume' | 'runNow'>,
    titleOf: (id: string) => string | null,
    now: () => number = Date.now
): RoutineAgentHost {
    return {
        list: (projectId) => routines.list(projectId),
        save: async (projectId, routine, ceiling, caller, shared, title) => {
            const madeBy = { chatId: caller, title: title ?? titleOf(caller) ?? caller, at: now() };
            const saved = await routines.saveByAgent(projectId, routine, ceiling, madeBy, shared);
            return { routine: saved.routine, shared: saved.shared };
        },
        pause: (projectId, routineId) => routines.pause(projectId, routineId),
        resume: (projectId, routineId) => routines.resume(projectId, routineId),
        runNow: (projectId, routineId) => routines.runNow(projectId, routineId)
    };
}
