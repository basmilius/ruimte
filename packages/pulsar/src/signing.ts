import type { BrokerRole } from './broker.ts';
import type { PushEnvelope } from './push.ts';
import type { SignalEnvelope } from './signaling.ts';

/*
 * Purpose prefixes prevent cross-protocol signatures. Ordered JSON preserves newlines and nulls
 * without ambiguous separators, and the `pulsar-` namespace stays separate from daemon handshakes.
 */
export const SIGNING_PURPOSES = {
    brokerHello: 'pulsar-broker-hello-v1',
    signal: 'pulsar-signal-v1',
    machineRegistration: 'pulsar-machine-registration-v1',
    accessRequest: 'pulsar-access-request-v1',
    accessStatement: 'pulsar-access-statement-v1',
    accessStatementV2: 'pulsar-access-statement-v2',
    sessionKey: 'pulsar-session-key-v1',
    sessionRefresh: 'pulsar-session-refresh-v1',
    deviceLinkStart: 'pulsar-device-link-start-v1',
    push: 'pulsar-push-v1',
    lanDoor: 'pulsar-lan-door-v1'
} as const;
export type SigningPurpose = (typeof SIGNING_PURPOSES)[keyof typeof SIGNING_PURPOSES];

function signedBytes(purpose: SigningPurpose, fields: ReadonlyArray<string | number | null>): string {
    return `${purpose}\n${JSON.stringify(fields)}`;
}

/*
 * A peer answering the broker's challenge. The broker's own host is in it, so a nonce another
 * service passed along yields a signature this broker refuses, and the role is in it, so a machine
 * key cannot be announced as a client or the other way round.
 */
export function brokerHelloMessage(broker: string, role: BrokerRole, publicKey: string, nonce: string): string {
    return signedBytes(SIGNING_PURPOSES.brokerHello, [broker, role, publicKey, nonce]);
}

/*
 * One signal from one key to another. Signing it end to end is what keeps the broker out of the
 * DTLS handshake: the fingerprint in an SDP is bound to the sender's key, so a broker that swaps it
 * for its own is caught by the receiver.
 */
export function signalMessage(from: string, to: string, envelope: SignalEnvelope): string {
    const { signal } = envelope;
    const body = (() => {
        switch (signal.kind) {
            case 'offer': {
                /* Signed with the offer, so a broker cannot take a statement off one attempt and put it on another.
                   The v2 fields stay out: a daemon from before them drops them before it checks this signature. */
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
}

// The daemon agreeing to join one account; the account id is in it, so the signature cannot be handed in under another.
export function machineRegistrationMessage(accountId: string, machineId: string, publicKey: string, name: string, issuedAt: number): string {
    return signedBytes(SIGNING_PURPOSES.machineRegistration, [accountId, machineId, publicKey, name, issuedAt]);
}

// A client asking for access to one machine, proving it holds the key the statement will name.
export function accessRequestMessage(machineId: string, clientPublicKey: string, nonce: string): string {
    return signedBytes(SIGNING_PURPOSES.accessRequest, [machineId, clientPublicKey, nonce]);
}

// The address book vouching that this client key and this machine belong to the same account, until `expiresAt`.
export function accessStatementMessage(machineId: string, clientPublicKey: string, nonce: string, issuedAt: number, expiresAt: number): string {
    return signedBytes(SIGNING_PURPOSES.accessStatement, [machineId, clientPublicKey, nonce, issuedAt, expiresAt]);
}

/*
 * The same, naming the key the account lists the machine with and the account itself. A machine id is
 * no secret, so only the key tells the machine that the account lists it and not a namesake.
 */
export function accessStatementV2Message(
    machineId: string,
    machinePublicKey: string,
    accountId: string,
    clientPublicKey: string,
    nonce: string,
    issuedAt: number,
    expiresAt: number
): string {
    return signedBytes(SIGNING_PURPOSES.accessStatementV2, [machineId, machinePublicKey, accountId, clientPublicKey, nonce, issuedAt, expiresAt]);
}

// The key a session is bound to, proven over the one-time login code so a key nobody holds is never bound.
export function sessionKeyMessage(code: string, sessionKey: string): string {
    return signedBytes(SIGNING_PURPOSES.sessionKey, [code, sessionKey]);
}

/*
 * A refresh, signed by the key the session is bound to. The refresh token is in it, so a signature is
 * good for one rotation only, and the time is in it, so one read off a request long ago is worth nothing.
 */
export function sessionRefreshMessage(refreshToken: string, issuedAt: number): string {
    return signedBytes(SIGNING_PURPOSES.sessionRefresh, [refreshToken, issuedAt]);
}

/*
 * A machine asking to be linked with a code. It names no account, so it can put the machine on none:
 * it only proves the key the approval page shows, and a registration signed later does the rest.
 */
export function deviceLinkStartMessage(machineId: string, publicKey: string, name: string, issuedAt: number): string {
    return signedBytes(SIGNING_PURPOSES.deviceLinkStart, [machineId, publicKey, name, issuedAt]);
}

/*
 * A push a machine hands the address book for one of its devices, signed with the machine key so the
 * address book and the device both know it came from that machine. A field that was added later is
 * signed only when present, so a push without it signs as it always did.
 */
export function pushMessage(push: PushEnvelope): string {
    const body: (string | number | null)[] =
        push.pushType !== 'liveactivity'
            ? [push.ephemeralKey, push.nonce, push.ciphertext]
            : [push.activity.title, push.activity.phase, push.activity.startedAt];
    if (push.pushType === 'liveactivity' && (push.activity.runningCount !== undefined || push.activity.attentionCount !== undefined)) {
        body.push(push.activity.runningCount ?? null, push.activity.attentionCount ?? null);
    }
    if (push.pushType === 'liveactivity' && push.activity.agents !== undefined) {
        body.push(push.activity.agents.length);
        for (const agent of push.activity.agents) {
            body.push(agent.nodeId, agent.target, agent.title, agent.phase);
            if (agent.startedAt !== undefined) {
                body.push(agent.startedAt);
            }
        }
    }
    return signedBytes(SIGNING_PURPOSES.push, [push.machineId, push.handle, push.id, push.issuedAt, push.expiresAt, push.collapseId, push.pushType, ...body]);
}

/*
 * A machine answering a client at its door on the local network. The nonce is the client's, so an
 * answer recorded once proves nothing later, and the machine's id and key are in it, so a client that
 * pinned one machine never believes another one that happens to sit at the same private address.
 */
export function lanDoorMessage(nonce: string, machineId: string, publicKey: string): string {
    return signedBytes(SIGNING_PURPOSES.lanDoor, [nonce, machineId, publicKey]);
}
