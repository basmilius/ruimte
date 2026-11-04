import type { AgentKind, ModelSelection, RoutineEntry } from '@ruimte/contracts';
import { create } from 'zustand';

/* What the routine form opens with: a project, and what the place it was opened from already knows. */
export interface RoutineFormRequest {
    projectId: string;
    /* A prompt to repeat, from a chat's send button. */
    prompt?: string;
    /* The agent and model of the chat it came from; the mode still starts at Supervised. */
    agent?: { provider: AgentKind; selection: ModelSelection };
    /* The routine to edit; absent makes a new one. */
    editing?: RoutineEntry;
    /* Lets a person pick the project, as on Routines over all projects. */
    pickProject?: boolean;
}

/* The routine form as a dialog of the workspace, one at a time; a new opening replaces what it showed. */
export const useRoutineForm = create<{ request: RoutineFormRequest | null; round: number }>(() => ({ request: null, round: 0 }));

/* Opens the form for a new routine or an edit, from the stage, the canvas menu, the palette or a chat. */
export function openRoutineForm(request: RoutineFormRequest): void {
    useRoutineForm.setState((state) => ({ request, round: state.round + 1 }));
}

export function closeRoutineForm(): void {
    useRoutineForm.setState({ request: null });
}
