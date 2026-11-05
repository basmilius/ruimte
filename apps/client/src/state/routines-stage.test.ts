import { afterEach, expect, test } from 'bun:test';
import { leaveRoutines, setRoutinesFilter, showRoutine, stepWeek, toggleRoutines, useRoutinesStage } from '@/state/routines-stage';

const START = useRoutinesStage.getState();

afterEach(() => {
    useRoutinesStage.setState(START, true);
});

test('opening Routines again starts at this week, whatever was open when it closed, and keeps the filter', () => {
    setRoutinesFilter('all');
    stepWeek(2);
    showRoutine({ projectId: 'project-atlas', routineId: 'morning' }, 'run-1');
    leaveRoutines();
    toggleRoutines();
    expect(useRoutinesStage.getState()).toMatchObject({ open: true, week: 0, routine: null, runId: null, filter: 'all' });
});
