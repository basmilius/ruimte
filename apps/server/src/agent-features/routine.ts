import { routineActions } from '../actions/routine-actions.ts';
import { agentRoutines } from '../routines/agent-host.ts';
import { routineToolkit } from '../tools/routine-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const routineFeature = defineAgentFeature({
    name: 'routine',
    toolkit: routineToolkit,
    actions: routineActions,
    host: ({ routines, store }) => ({ routines: agentRoutines(routines.routines, (id) => store.index.titleFor(id)) })
});
