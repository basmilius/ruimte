import type { BrokerRole } from './broker.ts';
import type { SignalEnvelope } from './signaling.ts';

/*
 * The exact bytes every signature in Pulsar is made over. Each purpose opens with a prefix line of
 * its own, and a prefix never contains a newline, so a signature for one purpose can never verify
 * as another. The fields follow as a JSON array in a fixed order: an SDP carries newlines and a
 * candidate's `sdpMid` may be null, and JSON keeps both apart from the fields around them where a
 * plain join would not. None of these prefixes starts with `ruimte-`, which is what the daemon's own
 * handshake in `@ruimte/contracts` signs under.
 */
export const SIGNING_PURPOSES = {
    brokerHello: 'pulsar-broker-hello-v1',
    signal: 'pulsar-signal-v1',
    machineRegistration: 'pulsar-machine-registration-v1',
    accessRequest: 'pulsar-access-request-v1',
    accessStatement: 'pulsar-access-statement-v1'
} as const;
export type SigningPurpose = (typeof SIGNING_PURPOSES)[keyof typeof SIGNING_PURPOSES];

const signedBytes = (purpose: SigningPurpose, fields: ReadonlyArray<string | number | null>): string => `${purpose}\n${JSON.stringify(fields)}`;

/*
 * A peer answering the broker's challenge. The broker's own host is in it, so a nonce another
 * service passed along yields a signature this broker refuses, and the role is in it, so a machine
 * key cannot be announced as a client or the other way round.
 */
export const brokerHelloMessage = (broker: string, role: BrokerRole, publicKey: string, nonce: string): string =>
    signedBytes(SIGNING_PURPOSES.brokerHello, [broker, role, publicKey, nonce]);

/*
 * One signal from one key to another. Signing it end to end is what keeps the broker out of the
 * DTLS handshake: the fingerprint in an SDP is bound to the sender's key, so a broker that swaps it
 * for its own is caught by the receiver.
 */
export const signalMessage = (from: string, to: string, envelope: SignalEnvelope): string => {
    const { signal } = envelope;
    const body = (() => {
        switch (signal.kind) {
            case 'offer': {
                // Signed with the offer, so a broker cannot take a statement off one attempt and put it on another.
                const access = signal.access;
                if (!access) {
                    return [signal.sdp];
                }
                const { statement } = access;
                return [
                    signal.sdp,
                    statement.machineId,
                    statement.clientPublicKey,
                    statement.nonce,
                    statement.issuedAt,
                    statement.expiresAt,
                    statement.signature,
                    access.label
                ];
            }
            case 'answer':
                return [signal.sdp];
            case 'candidate':
                return [signal.candidate, signal.sdpMid, signal.sdpMLineIndex];
            case 'close':
                return [signal.reason];
        }
    })();
    return signedBytes(SIGNING_PURPOSES.signal, [from, to, envelope.connectionId, signal.kind, ...body]);
};

// The daemon agreeing to join one account; the account id is in it, so the signature cannot be handed in under another.
export const machineRegistrationMessage = (accountId: string, machineId: string, publicKey: string, name: string, issuedAt: number): string =>
    signedBytes(SIGNING_PURPOSES.machineRegistration, [accountId, machineId, publicKey, name, issuedAt]);

// A client asking for access to one machine, proving it holds the key the statement will name.
export const accessRequestMessage = (machineId: string, clientPublicKey: string, nonce: string): string =>
    signedBytes(SIGNING_PURPOSES.accessRequest, [machineId, clientPublicKey, nonce]);

// The address book vouching that this client key and this machine belong to the same account, until `expiresAt`.
export const accessStatementMessage = (machineId: string, clientPublicKey: string, nonce: string, issuedAt: number, expiresAt: number): string =>
    signedBytes(SIGNING_PURPOSES.accessStatement, [machineId, clientPublicKey, nonce, issuedAt, expiresAt]);
