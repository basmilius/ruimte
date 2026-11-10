import { daemonProvedItself, keyProofFrame, secretProofFrame, type DirectChallengeFrame, type DirectProofFrame } from '@ruimte/contracts';
import { verifySignature } from '@ruimte/pulsar/verify-web';
import i18next from 'i18next';
import { clientKey, type ClientKey } from '@/endpoint/client-key';
import { endpointById } from '@/state/endpoints';
import { localSecretOf } from '@/transport-api/credentials';

interface ProofCredentials {
    /* The daemon this row pinned; null for the row of the machine this app runs on, which holds the local secret instead. */
    pinned: { publicKey: string; daemonId: string | null } | null;
    key: ClientKey | null;
    secret: string | null;
    label: string;
}

/*
 * What this client answers a channel's challenge with. A row of the account first checks that the
 * daemon signed this channel's binding with the key it pinned, and then signs the same binding back.
 * The row of this machine proves the local secret with an HMAC over the binding, so the secret never
 * crosses a channel it cannot check the other end of.
 */
export async function proveChallenge(credentials: ProofCredentials, challenge: DirectChallengeFrame, binding: string): Promise<DirectProofFrame> {
    const { daemon } = challenge;
    const { pinned } = credentials;
    if (pinned !== null) {
        if (!(await daemonProvedItself(pinned, challenge, binding, verifySignature))) {
            throw new Error(i18next.t('machines:direct.notProven', { label: credentials.label }));
        }
        if (credentials.key === null) {
            throw new Error(i18next.t('machines:direct.noKey'));
        }
        return keyProofFrame(credentials.key, pinned.daemonId ?? daemon.id, challenge.challenge, binding);
    }
    if (credentials.secret !== null) {
        return secretProofFrame(credentials.secret, daemon.id, challenge.challenge, binding);
    }
    throw new Error(i18next.t('machines:direct.needsPairedKey'));
}

export async function directProof(endpointId: string, challenge: DirectChallengeFrame, binding: string): Promise<DirectProofFrame> {
    const endpoint = endpointById(endpointId);
    if (!endpoint) {
        throw new Error(i18next.t('machines:link.notInList'));
    }
    const pinned = endpoint.daemonPublicKey === null ? null : { publicKey: endpoint.daemonPublicKey, daemonId: endpoint.daemonId };
    return proveChallenge(
        { pinned, key: pinned === null ? null : await clientKey(), secret: localSecretOf(endpoint.id), label: endpoint.label },
        challenge,
        binding
    );
}
