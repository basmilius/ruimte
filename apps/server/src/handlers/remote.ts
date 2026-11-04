import type { PeerStatement } from '@ruimte/pulsar';
import { statementAccountRefusal, type AccountBinding } from '../auth/auth-store.ts';
import { RequestError, type Dispatcher } from '../dispatcher.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { peerStatementSigned } from '../pulsar/statement.ts';
import type { PeerMachines } from '../remote/peer-machines.ts';
import type { PendingAdmissions } from '../remote/pending-admissions.ts';
import type { RemoteConnections } from '../remote/remote-connections.ts';
import type { RemoteStore } from '../remote/remote-store.ts';

/* What the link to other machines needs from this one. */
interface PeerLinkHost {
    machineId: string;
    machinePublicKey: string;
    peerPublicKey(): Promise<string>;
    pending: PendingAdmissions;
    machines: Pick<PeerMachines, 'put' | 'remove'>;
    connections: Pick<RemoteConnections, 'connectWithStatement' | 'close'>;
    /* The keys the address book signs with. */
    trustedKeys: readonly string[];
    accountBinding(): Promise<AccountBinding | null | undefined>;
    /* Ends the reconnects owed to a machine that is unlinked. */
    lapse(machineId: string): Promise<void>;
    now(): number;
}

/*
 * A broker a link may go through: over TLS, or on this machine for a development setup. A broker only
 * carries signals each side signed, but a plain socket would hand them to anyone on the way. The page
 * passes the broker the address book lists for that machine; this machine cannot ask the address book itself.
 */
function acceptableBrokerUrl(value: string): boolean {
    const url = URL.parse(value);
    if (url === null || url.username !== '' || url.password !== '') {
        return false;
    }
    return url.protocol === 'wss:' || (url.protocol === 'ws:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname));
}

/* Why a statement cannot be used by this machine to work in `machineId`, or null when it can. */
async function statementRefusal(statement: PeerStatement, machineId: string, peers: PeerLinkHost): Promise<string | null> {
    if (
        statement.machineId !== machineId ||
        statement.peerMachineId !== peers.machineId ||
        statement.peerMachinePublicKey !== peers.machinePublicKey ||
        statement.peerPublicKey !== (await peers.peerPublicKey()) ||
        statement.expiresAt < peers.now()
    ) {
        return 'That statement is not for this machine to work in that one, or it has run out';
    }
    // The key of the machine to work in is pinned from this statement, so the address book has to have signed it.
    if (!peerStatementSigned(statement, peers.trustedKeys)) {
        return 'The address book did not sign that statement';
    }
    if (statementAccountRefusal(await peers.accountBinding(), statement.accountId) !== null) {
        return 'That statement is for another account than the one this machine is on';
    }
    return null;
}

/*
 * Which checkout on another machine a project here is linked to, and the link to that machine. Any
 * client may ask, since it is a person who works on another machine; the window's own connection to
 * it is separate from this one.
 */
export function registerRemoteHandlers(dispatcher: Dispatcher, remote: RemoteStore, projects: Pick<ProjectStore, 'known'>, peers: PeerLinkHost): void {
    const requireProject = async (projectId: string): Promise<void> => {
        if (!(await projects.known()).some((project) => project.projectId === projectId)) {
            throw new RequestError('project-not-found', `No project ${projectId} is on this machine`);
        }
    };

    dispatcher.register('remote.list', async (payload) => {
        await requireProject(payload.projectId);
        return { links: remote.linksOf(payload.projectId) };
    });

    dispatcher.register('remote.link', async ({ projectId, ...link }) => {
        await requireProject(projectId);
        await remote.link(projectId, link);
        return link;
    });

    dispatcher.register('remote.unlink', async (payload) => {
        await requireProject(payload.projectId);
        if (remote.usesMachine(payload.projectId, payload.machineId)) {
            throw new RequestError('machine-in-use', 'A node of this project still runs on that machine; remove it first');
        }
        await remote.unlink(payload.projectId, payload.machineId);
        // The last project that links to a machine takes the link to it along: no reconnect, and no key kept.
        if (!remote.isLinked(payload.machineId)) {
            peers.connections.close(payload.machineId);
            peers.pending.release(payload.machineId);
            await peers.lapse(payload.machineId);
            await peers.machines.remove(payload.machineId);
        }
        return {};
    });

    /*
     * Any client may hand over a peer statement: it is a person who links two machines, and the statement
     * only opens the other machine to the peer key of this one, which that machine's own link then limits.
     * The answer comes once the link is open, or says why it could not be.
     */
    dispatcher.register('remote.connect', async ({ machineId, statement, brokerUrl }) => {
        const refusal = await statementRefusal(statement, machineId, peers);
        if (refusal !== null) {
            throw new RequestError('bad-statement', refusal);
        }
        if (brokerUrl && !acceptableBrokerUrl(brokerUrl)) {
            throw new RequestError('bad-broker', 'A link goes through a broker over wss:// only');
        }
        await peers.machines.put({ machineId, publicKey: statement.machinePublicKey, ...(brokerUrl ? { brokerUrl } : {}) }, peers.now());
        peers.pending.hold(statement);
        try {
            await peers.connections.connectWithStatement(machineId);
        } catch (e) {
            throw new RequestError('peer-unreachable', e instanceof Error ? e.message : 'That machine did not answer');
        }
        return {};
    });
}
