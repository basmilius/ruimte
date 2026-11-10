import { useEndpoints } from '@/state/endpoints';
import { usePulsarMachines } from '@/state/pulsar-machines';
import { forgetEndpoint } from '@/workspace/forget-endpoint';
import { usePulsarAccount } from '../pulsar/account';
import { rowsRemovedFromAccount } from '../pulsar/removal';

/*
 * Applies the removal rule whenever the account list arrives: on sign in, on every refresh the pane
 * or a registration asks for. Only a fresh list triggers it, never a new row, so a row is judged
 * against the account the next time it answers and not against a list that was already on screen.
 */
export function startRemovalWatch(): () => void {
    return usePulsarMachines.subscribe((state, before) => {
        if (state.machines === before.machines && state.removedMachineIds === before.removedMachineIds) {
            return;
        }
        if (usePulsarAccount.getState().status !== 'signed-in' || state.machines === null) {
            return;
        }
        for (const endpointId of rowsRemovedFromAccount(useEndpoints.getState().endpoints, state.removedMachineIds)) {
            void forgetEndpoint(endpointId);
        }
    });
}
