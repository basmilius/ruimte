import type { AgentInfo, AgentStatus, MachineWork } from '@ruimte/contracts';

interface WorkFacts {
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
export function childCounter(processes: readonly { pid: number; ppid: number; path?: string | null }[]): (pid: number) => number {
    const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
    // Git for Windows's `bin\bash.exe` only starts `usr\bin\bash.exe`, the real shell, so that one is not work and what it runs counts for the launcher.
    const isGitBashShell = (entry: { ppid: number; path?: string | null }): boolean =>
        /\\usr\\bin\\bash\.exe$/i.test(entry.path ?? '') && /\\bin\\bash\.exe$/i.test(byPid.get(entry.ppid)?.path ?? '');
    const counts = new Map<number, number>();
    for (const entry of processes) {
        if (isGitBashShell(entry)) {
            continue;
        }
        const parent = byPid.get(entry.ppid);
        const owner = parent !== undefined && isGitBashShell(parent) ? parent.ppid : entry.ppid;
        counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    return (pid) => counts.get(pid) ?? 0;
}
