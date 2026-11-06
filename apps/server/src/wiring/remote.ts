import type { EndpointIdentity } from '../endpoint-id.ts';
import type { OutboxStore } from '../outbox/outbox.ts';
import { PeerMachines } from '../peer/giver/peer-machines.ts';
import { RemoteConnections, brokerDialer } from '../peer/giver/remote-connections.ts';
import { RemoteStatus } from '../peer/giver/remote-status.ts';
import type { DaemonBundles } from './bundles.ts';
import type { Later } from './later.ts';
import type { MachineBundle } from './machine.ts';

/* The links this machine holds to the machines it works in, with what it remembers about them. */
export interface RemoteBundle {
    machines: PeerMachines;
    status: RemoteStatus;
    connections: RemoteConnections;
    /* Runs after the machine left its account and forgot what it held of it, for what is built after this bundle. */
    onLeave(listener: () => Promise<void> | void): void;
}

interface RemoteInput {
    home: string;
    identity: EndpointIdentity;
    machine: MachineBundle;
    outbox: OutboxStore;
    later: Later<Pick<DaemonBundles, 'network'>>;
}

export async function wireRemote({ home, identity, machine, outbox, later }: RemoteInput): Promise<RemoteBundle> {
    const machines = new PeerMachines(home);
    await machines.load();
    const status = new RemoteStatus();
    const connections = new RemoteConnections({
        machines,
        pending: machine.pendingAdmissions,
        status,
        owed: (machineId) => outbox.targetsOwedTo(machineId).length,
        unstarted: (machineId, except) =>
            outbox.ofKind('start-remote-agent').flatMap((entry) => (entry.payload.machineId === machineId && entry.id !== except ? [entry.target] : [])),
        dialer: brokerDialer({ signer: machine.peerKey, defaultBroker: () => later.network().brokerSwitch.describe().brokerUrl, label: () => identity.label })
    });
    const leaving: Array<() => Promise<void> | void> = [];
    // Another account's machines never vouched for this one: its key, the machines it knew and the statements it held go with the account.
    machine.auth.onLeft(async () => {
        connections.closeAll();
        machine.pendingAdmissions.clear();
        await machines.wipe();
        await machine.peerKey.wipe();
        for (const listener of leaving) {
            await listener();
        }
    });
    return { machines, status, connections, onLeave: (listener) => void leaving.push(listener) };
}
