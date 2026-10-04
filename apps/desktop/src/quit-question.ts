import type { MachineWork } from '@ruimte/contracts';
import type { AgentActivity } from '@ruimte/desktop-bridge';

export interface QuitFacts {
    /* Whether what runs on the machine outlives this quit: the service keeps it, or the app never ran it. */
    survives: boolean;
    language?: string;
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

function agentsWorking(agents: number, dutch: boolean): string {
    if (dutch) {
        return agents === 1 ? 'Er is nog een agent aan het werk.' : `Er zijn nog ${agents} agents aan het werk.`;
    }
    return agents === 1 ? 'An agent is still working.' : `${agents} agents are still working.`;
}

function terminalsRunning(terminals: number, dutch: boolean): string {
    if (dutch) {
        return terminals === 1 ? 'Er draait nog iets in een terminal.' : `Er draait nog iets in ${terminals} terminals.`;
    }
    return terminals === 1 ? 'A terminal is still running something.' : `${terminals} terminals are still running something.`;
}

function bothRunning(agents: number, terminals: number, dutch: boolean): string {
    if (dutch) {
        return `${agents === 1 ? 'Een agent' : `${agents} agents`} en ${terminals === 1 ? 'een terminal' : `${terminals} terminals`} zijn nog actief.`;
    }
    return `${agents === 1 ? 'An agent' : `${agents} agents`} and ${terminals === 1 ? 'a terminal' : `${terminals} terminals`} are still running.`;
}

/*
 * The question before a quit, or null when there is nothing to ask. When the quit ends the machine,
 * the machine itself says what runs on it, since a window that closed took its count with it.
 */
export function quitQuestion(facts: QuitFacts): QuitQuestion | null {
    const dutch = facts.language?.split('-')[0] === 'nl';
    if (facts.survives) {
        if (facts.windows.working === 0) {
            return null;
        }
        return {
            type: 'question',
            buttons: dutch ? ['Afsluiten', 'Annuleren'] : ['Quit', 'Cancel'],
            defaultId: 0,
            cancelId: 1,
            message: agentsWorking(facts.windows.working, dutch),
            detail: dutch
                ? 'Ze blijven op deze machine draaien nadat Ruimte sluit. Je kunt vanuit elke client verdergaan.'
                : 'They keep running on this machine after Ruimte quits, and you can pick them up from any client.'
        };
    }
    const agents = Math.max(facts.windows.working, facts.machine?.agents ?? 0);
    const terminals = facts.machine?.terminals ?? 0;
    if (agents === 0 && terminals === 0) {
        return null;
    }
    let message = bothRunning(agents, terminals, dutch);
    if (terminals === 0) {
        message = agentsWorking(agents, dutch);
    } else if (agents === 0) {
        message = terminalsRunning(terminals, dutch);
    }
    return {
        type: 'question',
        buttons: dutch ? ['Toch afsluiten', 'Verder werken'] : ['Quit anyway', 'Keep working'],
        defaultId: 1,
        cancelId: 1,
        message,
        detail: dutch ? 'Afsluiten beëindigt hun sessies op deze machine.' : 'Quitting ends their sessions on this machine.'
    };
}
