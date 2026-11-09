import type { AgentKind, ModelSelection, RoutineEntry } from '@ruimte/contracts';
import { create } from 'zustand';

export interface RoutineFormRequest {
    projectId: string;
    prompt?: string;
    /* The agent and model of the chat it came from; the mode still starts at Supervised. */
    agent?: { provider: AgentKind; selection: ModelSelection };
    editing?: RoutineEntry;
    pickProject?: boolean;
}

export const useRoutineForm = create<{ request: RoutineFormRequest | null; round: number }>(() => ({ request: null, round: 0 }));

export function openRoutineForm(request: RoutineFormRequest): void {
    useRoutineForm.setState((state) => ({ request, round: state.round + 1 }));
}

export function closeRoutineForm(): void {
    useRoutineForm.setState({ request: null });
}
