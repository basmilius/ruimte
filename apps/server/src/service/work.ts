import type { AgentInfo, AgentStatus, MachineWork } from '@ruimte/contracts';

export interface WorkFacts {
    /* `launch` is a session a launch runs in, whose shell execs the command and so has no child to count. */
    sessions: readonly { pid: number; exited: boolean; agent?: AgentInfo | null; launch?: boolean }[];
    chats: readonly { activeTurnId: string | null }[];
    /* How many processes have this pid as their parent; null where the process table cannot be read. */
    children: ((pid: number) => number) | null;
}

const IN_TURN: ReadonlySet<AgentStatus> = new Set(['running', 'needs-you']);

export function workOf(facts: WorkFacts): MachineWork {
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
        if (session.launch === true || facts.children === null || facts.children(session.pid) > 0) {
            terminals += 1;
        }
    }
    for (const chat of facts.chats) {
        if (chat.activeTurnId !== null) {
            agents += 1;
        }
    }
    return { terminals, agents };
}

/* A child count over one reading of the process table. */
export function childCounter(processes: readonly { pid: number; ppid: number }[]): (pid: number) => number {
    const counts = new Map<number, number>();
    for (const entry of processes) {
        counts.set(entry.ppid, (counts.get(entry.ppid) ?? 0) + 1);
    }
    return (pid) => counts.get(pid) ?? 0;
}
