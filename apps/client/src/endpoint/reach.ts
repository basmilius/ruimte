import i18next from 'i18next';
import { openAccountMachine, rowForAccountMachine, usePulsarMachines } from '@/pulsar/machines';
import { useEndpoints } from '@/state/endpoints';
import { pool } from '@/transport';
import { MachineLinks } from './ensure-machine';

const links = new MachineLinks({
    rowFor: (id) => rowForAccountMachine(id, useEndpoints.getState().endpoints),
    createRow: (id) => {
        const machine = usePulsarMachines.getState().machines?.find((entry) => entry.id === id);
        if (!machine) {
            throw new Error(i18next.t('machines:link.notOnAccount'));
        }
        return openAccountMachine(machine);
    },
    connection: (endpointId) => pool.statusOf(endpointId),
    hold: (endpoint) => pool.hold(endpoint),
    subscribe: (endpointId, handler) => pool.subscribeStatus(endpointId, handler),
    reconnect: (endpointId) => pool.reconnect(endpointId)
});

/*
 * The one way to bring a machine up before working on it, by row id or machine id: a paired row, a
 * row opened from the account, or a machine only the account list has. Resolves with the row id once
 * the link is open; see `MachineLinks` for the rules.
 */
export const ensureMachine = (id: string, signal?: AbortSignal): Promise<string> => links.ensure(id, signal);
