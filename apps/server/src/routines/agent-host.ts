import type { Routine, RoutineListResult, RoutineRunNowResult, RuntimeMode } from '@ruimte/contracts';
import type { Routines } from './routines.ts';

/*
 * The routines of a project as an agent reaches them. Its save never approves and is narrowed to its
 * mode ceiling, with the caller written down as its maker; a run starts only one a person approved.
 */
export interface RoutineAgentHost {
    list(projectId: string): Promise<RoutineListResult>;
    /* `shared` places a new routine; one that exists stays in the file it is in. */
    save(projectId: string, routine: Routine, ceiling: RuntimeMode, caller: string, shared: boolean): Promise<{ routine: Routine; shared: boolean }>;
    pause(projectId: string, routineId: string): Promise<void>;
    resume(projectId: string, routineId: string): Promise<void>;
    runNow(projectId: string, routineId: string): Promise<RoutineRunNowResult>;
}

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
        save: async (projectId, routine, ceiling, caller, shared) => {
            const madeBy = { chatId: caller, title: titleOf(caller) ?? caller, at: now() };
            const saved = await routines.saveByAgent(projectId, routine, ceiling, madeBy, shared);
            return { routine: saved.routine, shared: saved.shared };
        },
        pause: (projectId, routineId) => routines.pause(projectId, routineId),
        resume: (projectId, routineId) => routines.resume(projectId, routineId),
        runNow: (projectId, routineId) => routines.runNow(projectId, routineId)
    };
}
