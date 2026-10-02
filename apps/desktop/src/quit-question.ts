import type { MachineWork } from '@ruimte/contracts';
import type { AgentActivity } from '@ruimte/desktop-bridge';

export interface QuitFacts {
    /* Whether what runs on the machine outlives this quit: the service keeps it, or the app never ran it. */
    survives: boolean;
    /* What the open windows count; nothing once the last one closed, as on Linux or before an update installs. */
    windows: AgentActivity;
    /* What the daemon says runs on it, asked only when the quit ends it; null when it cannot say. */
    machine: MachineWork | null;
}

/* The options of Electron's message box. */
export interface QuitQuestion {
    type: 'question';
    buttons: string[];
    defaultId: number;
    cancelId: number;
    message: string;
    detail: string;
}

const agentsWorking = (agents: number): string => (agents === 1 ? 'An agent is still working.' : `${agents} agents are still working.`);

const terminalsRunning = (terminals: number): string =>
    terminals === 1 ? 'A terminal is still running something.' : `${terminals} terminals are still running something.`;

const bothRunning = (agents: number, terminals: number): string =>
    `${agents === 1 ? 'An agent' : `${agents} agents`} and ${terminals === 1 ? 'a terminal' : `${terminals} terminals`} are still running.`;

/*
 * The question before a quit, or null when there is nothing to ask. When the quit ends the machine,
 * the machine itself says what runs on it, since a window that closed took its count with it.
 */
export const quitQuestion = (facts: QuitFacts): QuitQuestion | null => {
    if (facts.survives) {
        if (facts.windows.working === 0) {
            return null;
        }
        return {
            type: 'question',
            buttons: ['Quit', 'Cancel'],
            defaultId: 0,
            cancelId: 1,
            message: agentsWorking(facts.windows.working),
            detail: 'They keep running on this machine after Ruimte quits, and you can pick them up from any client.'
        };
    }
    const agents = Math.max(facts.windows.working, facts.machine?.agents ?? 0);
    const terminals = facts.machine?.terminals ?? 0;
    if (agents === 0 && terminals === 0) {
        return null;
    }
    let message = bothRunning(agents, terminals);
    if (terminals === 0) {
        message = agentsWorking(agents);
    } else if (agents === 0) {
        message = terminalsRunning(terminals);
    }
    return {
        type: 'question',
        buttons: ['Quit anyway', 'Keep working'],
        defaultId: 1,
        cancelId: 1,
        message,
        detail: 'Quitting ends their sessions on this machine.'
    };
};
