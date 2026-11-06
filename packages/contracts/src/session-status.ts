import type { AgentInfo, AgentStatus } from './agent.ts';

/* What a terminal's status is read from: the shell this client holds and the record the CLI's hooks wrote. */
export interface SessionReading {
    /* True while this client holds a live attachment on the daemon. */
    attached: boolean;

    /* Exit code of the shell, once it has ended. Absent while it runs. */
    exited?: number;

    /* The agent CLI the daemon last saw in this shell, reported through its hooks. */
    agent?: Pick<AgentInfo, 'live' | 'status'> | null;
}

/* The status of a terminal, or undefined while nothing runs in it. The iPhone app reads it by the same rule (`SessionReading`). */
export function sessionStatus(state: SessionReading | undefined): AgentStatus | undefined {
    if (!state) {
        return undefined;
    }

    // A live agent knows better than the shell what is going on.
    if (state.agent?.live) {
        return state.agent.status;
    }

    // The daemon marks the record when the CLI went down with the shell, and it outlives the shell.
    if (state.agent?.status === 'exited') {
        return 'exited';
    }

    if (state.exited !== undefined) {
        return 'error';
    }

    return state.attached ? 'running' : undefined;
}
