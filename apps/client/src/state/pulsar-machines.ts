import type { Machine } from '@ruimte/pulsar';
import { create } from 'zustand';
import type { Endpoint } from '@/state/endpoints';
import { hasLocalMachine, listedEndpoints } from '@/state/local-machine';

interface MachinesState {
    // Null until the account list has been asked for once.
    machines: Machine[] | null;
    // Machines a person took off the account, which only a person puts back.
    removedMachineIds: string[];
    error: string | null;
}

/* The machines on the account this client is signed in to. */
export const usePulsarMachines = create<MachinesState>(() => ({ machines: null, removedMachineIds: [], error: null }));

/* The row this client keeps for a machine on the account, whatever id the row is under. */
export function rowForAccountMachine(machineId: string, endpoints: readonly Endpoint[], local = hasLocalMachine()): Endpoint | null {
    return listedEndpoints(endpoints, local).find((endpoint) => endpoint.id === machineId || endpoint.daemonId === machineId) ?? null;
}

/*
 * A row for a machine this client has never reached. There is no address of its own to try, so it is
 * reached directly through the broker until `endpoint.info` names its doors on the local network; the
 * key comes from the account list, which is the trust signing in buys. Null for a machine on no
 * broker, which a client that never reached it has no way to find.
 */
export function endpointForAccountMachine(machine: Machine): Endpoint | null {
    return machine.brokerUrl === null
        ? null
        : {
              id: machine.id,
              label: machine.name,
              httpBaseUrl: '',
              wsBaseUrl: '',
              reachability: 'public',
              daemonId: machine.id,
              daemonPublicKey: machine.publicKey,
              direct: true,
              brokerUrl: machine.brokerUrl,
              pairedBy: 'statement',
              needsStatement: true
          };
}
