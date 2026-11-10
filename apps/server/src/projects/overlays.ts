import { MachineHome } from '../disk/machine-home.ts';
import { HiddenAgentStore } from './hidden-agents.ts';
import { PeerLinks } from './peer-links.ts';
import { RemoteStore } from './remote-store.ts';

/* What a project store lays over a document without writing it to the project's files; the wiring makes them and shares them with the features that read them. */
export interface ProjectOverlays {
    hiddenAgents: HiddenAgentStore;
    remote: RemoteStore;
    peers: PeerLinks;
    /* A folder a client names to open stops at the machine's own state, as its file requests do. */
    machineHome: MachineHome;
}

/* The overlays over one home, for a test that has no wiring; the daemon passes the `MachineHome` it shares. */
export function projectOverlays(home: string, machineHome: MachineHome = new MachineHome(home)): ProjectOverlays {
    return { hiddenAgents: new HiddenAgentStore(home), remote: new RemoteStore(home), peers: new PeerLinks(home), machineHome };
}
