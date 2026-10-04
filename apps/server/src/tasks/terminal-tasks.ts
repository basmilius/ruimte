import type { TaskCoordinator } from '@ruimte/agents/tasks/task-coordinator';
import type { SessionEvent } from '../sessions/manager.ts';

const TERMINAL_ENDED = 'It ended without a result: a terminal reports back with ruimte-context done.';

export interface TerminalTasks {
    /* A terminal whose shell went, with or without its agent saying so first. */
    ended(sessionId: string): void;
    /* For `sessions.observe()`: a terminal agent that said goodbye. */
    sessionEvent(event: SessionEvent): void;
}

/* A terminal agent has no turn that answers its task, so only `done` settles it and its end fails it. */
export function terminalTasks(coordinator: Pick<TaskCoordinator, 'agentEnded'>): TerminalTasks {
    return {
        ended: (sessionId) => coordinator.agentEnded(sessionId, TERMINAL_ENDED),
        sessionEvent: (event) => {
            if (event.event !== 'session.status' || event.payload.agent?.status !== 'exited') {
                return;
            }
            coordinator.agentEnded(event.payload.sessionId, TERMINAL_ENDED);
        }
    };
}
