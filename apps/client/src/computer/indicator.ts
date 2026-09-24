import i18next from 'i18next';
import type { ComputerControlAction, ComputerSessionMode, ComputerUseStatus } from '@ruimte/contracts';
import { useComputer } from '@/state/computer';

export interface IndicatorLook {
    // The accent while the agent acts, muted while the person holds the Mac: the phantom cursor's own two tones.
    tone: 'accent' | 'muted';
    label: string;
    // What a click offers: the buttons of the session bar.
    actions: readonly ComputerControlAction[];
}

/* How the session stands while this node's agent holds the Mac; null while it does not. */
export const nodeSessionMode = (status: ComputerUseStatus | undefined, nodeId: string): ComputerSessionMode | null => {
    const session = status?.session;
    return session && session.nodeId === nodeId ? session.mode : null;
};

export const useNodeComputerSession = (endpointId: string, nodeId: string): ComputerSessionMode | null =>
    useComputer((s) => nodeSessionMode(s.statuses[endpointId], nodeId));

/* `machine` is the label the rest of the client gives the machine the agent operates. */
export const indicatorLook = (mode: ComputerSessionMode, machine: string): IndicatorLook => ({
    tone: mode === 'running' ? 'accent' : 'muted',
    label: i18next.t(`computer:indicator.${mode}`, { machine }),
    actions: mode === 'running' ? ['pause', 'stop'] : ['resume', 'stop']
});
