import { routineActions } from '../actions/routine-actions.ts';
import { agentRoutines, type RoutineAgentHost } from '../routines/agent-host.ts';
import { routineToolkit } from '../tools/routine-tools.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The routines of the caller's project as an agent may reach them; absent on a host that keeps none. */
        routines?: RoutineAgentHost;
    }
}

export const routineFeature = defineAgentFeature({
    name: 'routine',
    toolkit: routineToolkit,
    actions: routineActions,
    host: ({ routines, store }) => ({ routines: agentRoutines(routines.routines, (id) => store.index.titleFor(id)) })
});
