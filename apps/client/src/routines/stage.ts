import { create } from 'zustand';

/* A routine on the stage, by the project it lives in. */
interface RoutineRef {
    projectId: string;
    routineId: string;
}

type RoutinesFilter = 'project' | 'all';

/* The week as a grid of days, or as a list of its runs and coming times day by day. */
type RoutinesLayout = 'week' | 'list';

interface RoutinesStage {
    open: boolean;
    /* Weeks away from the one we are in; 0 is this week. */
    week: number;
    filter: RoutinesFilter;
    layout: RoutinesLayout;
    /* The routine opened inside the stage, or null for the week. */
    routine: RoutineRef | null;
    /* The run picked in that routine's timeline; null picks its newest run. */
    runId: string | null;
}

/* Routines as a sheet over the workspace, one per window: what this client shows, never written to a project file. */
export const useRoutinesStage = create<RoutinesStage>(() => ({ open: false, week: 0, filter: 'project', layout: 'week', routine: null, runId: null }));

/* Always the start: this week's overview, never the routine or week left open last time. Filter and layout stay. */
function openRoutines(): void {
    useRoutinesStage.setState({ open: true, week: 0, routine: null, runId: null });
}

export function leaveRoutines(): void {
    if (useRoutinesStage.getState().open) {
        useRoutinesStage.setState({ open: false });
    }
}

export function toggleRoutines(): void {
    if (useRoutinesStage.getState().open) {
        leaveRoutines();
    } else {
        openRoutines();
    }
}

export function showRoutine(routine: RoutineRef | null, runId: string | null = null): void {
    useRoutinesStage.setState({ open: true, routine, runId });
}

export function stepWeek(delta: number): void {
    useRoutinesStage.setState((state) => ({ week: delta === 0 ? 0 : state.week + delta }));
}

export function setRoutinesFilter(filter: RoutinesFilter): void {
    useRoutinesStage.setState({ filter });
}

export function setRoutinesLayout(layout: RoutinesLayout): void {
    useRoutinesStage.setState({ layout });
}
