import {
    clientChannelMessage,
    daemonChannelMessage,
    localSecretChannelMessage,
    PROTOCOL_VERSION,
    type DirectChallengeFrame,
    type DirectProofFrame
} from '@ruimte/contracts';
import { clientKey, type ClientKey } from '@/endpoint/client-key';
import { localSecretOf } from '@/endpoint/credentials';
import { verifyDaemon } from '@/endpoint/handshake';
import { endpointById } from '@/state/endpoints';

export interface ProofCredentials {
    /* The daemon this row pinned; null for the row of the machine this app runs on, which holds the local secret instead. */
    pinned: { publicKey: string; daemonId: string | null } | null;
    key: ClientKey | null;
    secret: string | null;
    label: string;
}

const base64url = (bytes: ArrayBuffer): string => {
    let binary = '';
    for (const byte of new Uint8Array(bytes)) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const hmac = async (secret: string, message: string): Promise<string> => {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
};

/*
 * What this client answers a channel's challenge with. A paired row first checks that the daemon
 * signed this channel's binding with the key it pinned, the same check the HTTP handshake makes, and
 * then signs the same binding back. The row of this machine proves the local secret with an HMAC
 * over the binding, so the secret never crosses a channel it cannot check the other end of.
 */
export const proveChallenge = async (credentials: ProofCredentials, challenge: DirectChallengeFrame, binding: string): Promise<DirectProofFrame> => {
    const { daemon } = challenge;
    const { pinned } = credentials;
    if (pinned !== null) {
        const identical = daemon.publicKey === pinned.publicKey && (pinned.daemonId === null || pinned.daemonId === daemon.id);
        if (!identical || !(await verifyDaemon(pinned.publicKey, daemonChannelMessage(daemon.id, challenge.challenge, binding), daemon.signature))) {
            throw new Error(`${credentials.label} did not prove its identity over the direct connection`);
        }
        if (credentials.key === null) {
            throw new Error('A direct connection signs in with a key, and this browser cannot make one');
        }
        const signature = await credentials.key.sign(
            clientChannelMessage(pinned.daemonId ?? daemon.id, challenge.challenge, credentials.key.publicKey, binding)
        );
        return { type: 'direct.key', protocol: PROTOCOL_VERSION, challenge: challenge.challenge, publicKey: credentials.key.publicKey, signature };
    }
    if (credentials.secret !== null) {
        return {
            type: 'direct.secret',
            protocol: PROTOCOL_VERSION,
            challenge: challenge.challenge,
            proof: await hmac(credentials.secret, localSecretChannelMessage(daemon.id, challenge.challenge, binding))
        };
    }
    throw new Error('A direct connection needs a paired key. Pair this machine again.');
};

/* The proof for one row, with what this client holds for it right now. */
export const directProof = async (endpointId: string, challenge: DirectChallengeFrame, binding: string): Promise<DirectProofFrame> => {
    const endpoint = endpointById(endpointId);
    if (!endpoint) {
        throw new Error('This machine is no longer in the list');
    }
    const pinned = endpoint.daemonPublicKey === null ? null : { publicKey: endpoint.daemonPublicKey, daemonId: endpoint.daemonId };
    return proveChallenge(
        { pinned, key: pinned === null ? null : await clientKey(), secret: localSecretOf(endpoint.id), label: endpoint.label },
        challenge,
        binding
    );
};
