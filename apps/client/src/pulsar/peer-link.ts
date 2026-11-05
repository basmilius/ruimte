import { randomToken, type PeerAccessRequestPayload, type PeerStatement } from '@ruimte/pulsar';
import i18next from 'i18next';
import type { Transport } from '@/transport-api/transport';
import { withAccessToken } from './account';
import { usePulsarMachines } from './machines';

type Requester = Pick<Transport, 'request'>;

/*
 * Lets this machine work in another one of the account: it signs the request, the address book vouches
 * for it with this page's session, and the machine takes the statement. The page is only the courier;
 * the machine holds no account token. The answer is checked against what was asked before it goes on.
 */
export async function linkPeer(options: {
    machineId: string;
    /* The machine this window works on, which is the one that will work in `machineId`. */
    self: Requester;
    /* The broker the address book lists for that machine. */
    brokerUrl: string | null;
    request(payload: PeerAccessRequestPayload): Promise<PeerStatement>;
}): Promise<void> {
    const { machineId, self } = options;
    const nonce = randomToken(18);
    const signed = await self.request('endpoint.signPeerAccess', { machineId, nonce });
    const statement = await options.request({ machineId, nonce, ...signed });
    if (
        statement.machineId !== machineId ||
        statement.nonce !== nonce ||
        statement.peerPublicKey !== signed.peerPublicKey ||
        statement.peerMachineId !== signed.peerMachineId
    ) {
        throw new Error(i18next.t('machines:account.statementMismatch'));
    }
    await self.request('remote.connect', { machineId, statement, ...(options.brokerUrl === null ? {} : { brokerUrl: options.brokerUrl }) });
}

/* The same, asked of the account this client is signed in to. */
export function linkPeerThroughAccount(machineId: string, self: Requester): Promise<void> {
    const brokerUrl = usePulsarMachines.getState().machines?.find((machine) => machine.id === machineId)?.brokerUrl ?? null;
    return linkPeer({ machineId, self, brokerUrl, request: (payload) => withAccessToken((client, token) => client.requestPeerStatement(token, payload)) });
}
