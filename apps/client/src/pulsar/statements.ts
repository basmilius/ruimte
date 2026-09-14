import { accessRequestMessage, type AccessRequestPayload, type AccessStatement, type SignalAccess } from '@ruimte/pulsar';
import type { ClientKey } from '@/endpoint/client-key';
import { currentClientLabel } from '@/endpoint/client-label';
import { withAccessToken } from './account';
import { randomToken } from './pkce';

/*
 * A statement for one offer to one machine. The nonce is new for every attempt and the machine spends
 * it, so a statement that leaks opens nothing a second time; the request is signed with this client's
 * key, so the address book only vouches for a key the asker holds. The answer is checked against what
 * was asked before it goes anywhere.
 */
export const requestSignalAccess = async (
    machineId: string,
    key: ClientKey,
    label: string,
    request: (payload: AccessRequestPayload) => Promise<AccessStatement>
): Promise<SignalAccess> => {
    const nonce = randomToken(18);
    const signature = await key.sign(accessRequestMessage(machineId, key.publicKey, nonce));
    const statement = await request({ machineId, clientPublicKey: key.publicKey, nonce, signature });
    if (statement.machineId !== machineId || statement.clientPublicKey !== key.publicKey || statement.nonce !== nonce) {
        throw new Error('Your account answered with a statement for something else');
    }
    return { statement, label: label.slice(0, 80) };
};

/* The same, asked of the account this client is signed in to. */
export const machineAccess = (machineId: string, key: ClientKey): Promise<SignalAccess> =>
    requestSignalAccess(machineId, key, currentClientLabel(), (payload) => withAccessToken((client, token) => client.requestStatement(token, payload)));
