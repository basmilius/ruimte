import type { ComputerControlAction, ComputerSessionMode, ComputerUseStatus } from '@ruimte/contracts';
import i18next from 'i18next';
import { useComputer } from '@/state/computer';

interface IndicatorLook {
    // The accent while the agent acts, muted while the person holds the Mac.
    tone: 'accent' | 'muted';
    label: string;
    // What a click offers: the items of the menu bar item on the Mac.
    actions: readonly ComputerControlAction[];
}

/* How the session stands while this node's agent holds the Mac; null while it does not. */
export function nodeSessionMode(status: ComputerUseStatus | undefined, nodeId: string): ComputerSessionMode | null {
    const session = status?.session;
    return session && session.nodeId === nodeId ? session.mode : null;
}

export function useNodeComputerSession(endpointId: string, nodeId: string): ComputerSessionMode | null {
    return useComputer((s) => nodeSessionMode(s.statuses[endpointId], nodeId));
}

/* `machine` is the label the rest of the client gives the machine the agent operates. */
export function indicatorLook(mode: ComputerSessionMode, machine: string): IndicatorLook {
    return {
        tone: mode === 'running' ? 'accent' : 'muted',
        label: i18next.t(`computer:indicator.${mode}`, { machine }),
        actions: mode === 'running' ? ['pause', 'stop'] : ['resume', 'stop']
    };
}
