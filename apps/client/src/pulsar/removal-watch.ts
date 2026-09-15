import { forgetEndpoint } from '@/endpoint';
import { useEndpoints } from '@/state/endpoints';
import { usePulsarAccount } from './account';
import { usePulsarMachines } from './machines';
import { rowsRemovedFromAccount } from './removal';

/*
 * Applies the removal rule whenever the account list arrives: on sign in, on every refresh the pane
 * or a registration asks for. Only a fresh list triggers it, never a new row, so a pairing is judged
 * against the account the next time it answers and not against a list that was already on screen.
 */
export const startRemovalWatch = (): (() => void) =>
    usePulsarMachines.subscribe((state, before) => {
        if (state.machines === before.machines && state.removedMachineIds === before.removedMachineIds) {
            return;
        }
        if (usePulsarAccount.getState().status !== 'signed-in' || state.machines === null) {
            return;
        }
        for (const endpointId of rowsRemovedFromAccount(useEndpoints.getState().endpoints, state.removedMachineIds, state.reclaiming)) {
            void forgetEndpoint(endpointId);
        }
    });
