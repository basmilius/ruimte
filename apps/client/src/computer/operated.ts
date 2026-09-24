import type { ComputerUseStatus } from '@ruimte/contracts';
import { useComputer } from '@/state/computer';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { useEndpointId } from '@/state/keys';
import { hasLocalMachine } from '@/state/local-machine';

/*
 * Whether this window is one the machine holds back while an agent operates Ruimte: the desktop's own
 * machine, reached with the local secret. A paired window on another device still decides. The machine
 * refuses either way; this only explains it before a press.
 */
export const operatedHere = (endpointId: string, status: ComputerUseStatus | undefined, local: boolean = hasLocalMachine()): boolean =>
    local && endpointId === LOCAL_ENDPOINT_ID && status?.session?.operatingRuimte === true;

export const useOperatedHere = (): boolean => {
    const endpointId = useEndpointId();
    return useComputer((s) => operatedHere(endpointId, s.statuses[endpointId]));
};
