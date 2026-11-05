import { AuthStore } from '../auth/auth-store.ts';
import { Handshake } from '../auth/handshake.ts';
import { readOrCreateLocalSecret } from '../auth/local-secret.ts';
import type { ServerConfig } from '../config.ts';
import { MachineHome } from '../disk/machine-home.ts';
import { readOrCreateEndpointIdentity, type EndpointIdentity } from '../endpoint-id.ts';
import { PeerKey } from '../remote/peer-key.ts';
import { PendingAdmissions } from '../remote/pending-admissions.ts';

/* Who the machine is and who may reach it. */
export interface MachineBundle {
    identity: EndpointIdentity;
    auth: AuthStore;
    handshake: Handshake;
    // The local secret and the tickets the handshake hands out, which every door checks a request against.
    access: { localSecret: string; tickets: Handshake };
    /* Where a client's file request stops under `$RUIMTE_HOME`. */
    machineHome: MachineHome;
    // The key other machines let this one in under, and the statements that open them to it once.
    peerKey: PeerKey;
    pendingAdmissions: PendingAdmissions;
}

export async function wireMachine(config: ServerConfig): Promise<MachineBundle> {
    // `--label` and `RUIMTE_LABEL` are the name a machine nobody has named yet answers to; a name
    // typed in a client wins over both, or renaming from another machine would not survive a restart.
    const [identity, localSecret] = await Promise.all([readOrCreateEndpointIdentity(config.home, config.label), readOrCreateLocalSecret(config.home)]);
    const auth = new AuthStore(config.home);
    const handshake = new Handshake(auth, identity);
    return {
        identity,
        auth,
        handshake,
        access: { localSecret, tickets: handshake },
        machineHome: new MachineHome(config.home),
        peerKey: new PeerKey(config.home),
        pendingAdmissions: new PendingAdmissions()
    };
}
