import { defineBehaviors, takeKey } from '@/commands/behavior';
import { openRoutineForm } from '@/routines/form-state';
import { currentEndpointId } from '@/state/current-endpoint';
import { useProject } from '@/state/project';
import { toggleRoutines } from '@/state/routines-stage';
import { pool } from '@/transport';
import { machineAnswers } from '@/transport/features';

function machineHasRoutines(): boolean {
    return machineAnswers(pool.statusOf(currentEndpointId()), 'routine.list');
}

export const ROUTINE_BEHAVIORS = defineBehaviors({
    routines: {
        run: toggleRoutines,
        offered: (moment) => moment.inWorkspace && machineHasRoutines(),
        key: (press) => {
            if (machineHasRoutines()) {
                takeKey(press, toggleRoutines);
            }

            return true;
        }
    },
    'routine-new': {
        run: () => {
            const projectId = useProject.getState().current?.projectId;
            if (projectId !== undefined) {
                openRoutineForm({ projectId });
            }
        },
        offered: (moment) => moment.inWorkspace && machineHasRoutines()
    }
});
