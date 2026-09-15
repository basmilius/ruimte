import type { AgentInfo, AgentStatus } from '@ruimte/contracts';

/*
 * What a restart of this daemon would cut short. Asked by the daemon before it updates itself and by
 * the desktop app before it restarts the service onto a new binary, so both mean the same by idle.
 */
export interface MachineWork {
    /* Shells with something running in them other than the shell, and no agent in a turn. */
    terminals: number;
    /* Terminal agents in a turn (or waiting on a person inside one) and chats with a turn in flight. */
    agents: number;
}

export interface WorkFacts {
    sessions: readonly { pid: number; exited: boolean; agent?: AgentInfo | null }[];
    chats: readonly { activeTurnId: string | null }[];
    /* How many processes have this pid as their parent; null where the process table cannot be read. */
    children: ((pid: number) => number) | null;
}

const IN_TURN: ReadonlySet<AgentStatus> = new Set(['running', 'needs-you']);

export const workOf = (facts: WorkFacts): MachineWork => {
    let terminals = 0;
    let agents = 0;
    for (const session of facts.sessions) {
        if (session.exited) {
            continue;
        }
        if (session.agent?.live === true && IN_TURN.has(session.agent.status)) {
            agents += 1;
            continue;
        }
        // Without a process table a live shell may be running anything, so it counts as work.
        if (facts.children === null || facts.children(session.pid) > 0) {
            terminals += 1;
        }
    }
    for (const chat of facts.chats) {
        if (chat.activeTurnId !== null) {
            agents += 1;
        }
    }
    return { terminals, agents };
};

export const isIdle = (work: MachineWork): boolean => work.terminals === 0 && work.agents === 0;

/* A child count over one reading of the process table. */
export const childCounter = (processes: readonly { pid: number; ppid: number }[]): ((pid: number) => number) => {
    const counts = new Map<number, number>();
    for (const entry of processes) {
        counts.set(entry.ppid, (counts.get(entry.ppid) ?? 0) + 1);
    }
    return (pid) => counts.get(pid) ?? 0;
};
