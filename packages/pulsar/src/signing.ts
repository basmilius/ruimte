import type { BrokerRole } from './broker.ts';
import type { PushEnvelope, PushRouting } from './push.ts';
import type { SignalEnvelope } from './signaling.ts';

/*
 * Every prefix Ruimte signs, MACs or derives a key under, so one test can hold that no two are alike
 * and none starts another. Ordered JSON preserves newlines and nulls without ambiguous separators.
 * The `ruimte-` rows keep the names they had before they moved here, so a signature made then still
 * verifies; the rest are in the `pulsar-` namespace.
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
    // The AAD of a push's encryption, so a ciphertext only opens under the routing it was sent with.
    pushRouting: 'pulsar-push-routing-v1',
    // The HKDF salt of a push's key, not a message.
    pushEncryption: 'pulsar-push-encryption-v1',
    lanDoor: 'pulsar-lan-door-v1',
    mapsTicketMac: 'pulsar-maps-ticket-mac-v1',
    // What the maps secret derives its subject key and its path key under, and the first line of a path's mark: keys, not signed messages.
    mapsTicketSubject: 'pulsar-maps-ticket-subject-v1',
    mapsPathKey: 'pulsar-maps-path-key-v1',
    mapsPath: 'pulsar-maps-path-v1',
    peerAccessRequest: 'pulsar-peer-access-request-v1',
    peerStatement: 'pulsar-peer-statement-v1',
    // The extension store's own key signs `index.json` whole.
    extensionStore: 'ruimte-extension-store-v1',
    daemonChallenge: 'ruimte-daemon-v1',
    clientAuth: 'ruimte-client-v1',
    daemonChannel: 'ruimte-daemon-channel-v1',
    clientChannel: 'ruimte-client-channel-v1',
    localChannel: 'ruimte-local-channel-v1',
    machineProof: 'ruimte machine proof v1'
} as const;
export type SigningPurpose = (typeof SIGNING_PURPOSES)[keyof typeof SIGNING_PURPOSES];

// The salt a push's key is derived with, from the shared secret and `pushEncryptionInfo`.
export const PUSH_HKDF_SALT = SIGNING_PURPOSES.pushEncryption;

export function extensionStoreMessage(index: string): string {
    return `${SIGNING_PURPOSES.extensionStore}\n${index}`;
}

function signedBytes(purpose: SigningPurpose, fields: ReadonlyArray<string | number | null>): string {
    return `${purpose}\n${JSON.stringify(fields)}`;
}

function signedLines(purpose: SigningPurpose, fields: readonly (string | number)[]): string {
    return [purpose, ...fields].join('\n');
}

/*
 * The daemon id in each message keeps a signature from proving anything to another machine, and the
 * client's key in its own keeps an answer for one key from being handed in under another.
 */
export function daemonChallengeMessage(daemonId: string, challenge: string): string {
    return signedLines(SIGNING_PURPOSES.daemonChallenge, [daemonId, challenge]);
}

export function clientAuthMessage(daemonId: string, challenge: string, publicKey: string): string {
    return signedLines(SIGNING_PURPOSES.clientAuth, [daemonId, challenge, publicKey]);
}

/*
 * The bytes signed on a channel. Prefixes of their own, so a signature over the HTTP handshake's
 * challenge never verifies as one over a channel's, and the binding last, since it is JSON and the
 * fields before it never hold a newline.
 */
export function daemonChannelMessage(daemonId: string, challenge: string, binding: string): string {
    return signedLines(SIGNING_PURPOSES.daemonChannel, [daemonId, challenge, binding]);
}

export function clientChannelMessage(daemonId: string, challenge: string, publicKey: string, binding: string): string {
    return signedLines(SIGNING_PURPOSES.clientChannel, [daemonId, challenge, publicKey, binding]);
}

// Keyed with the local secret as an HMAC-SHA256, so the channel learns that the client holds it and never the secret itself.
export function localSecretChannelMessage(daemonId: string, challenge: string, binding: string): string {
    return signedLines(SIGNING_PURPOSES.localChannel, [daemonId, challenge, binding]);
}

/*
 * What a daemon's proof of the local secret covers. The port is in it too, so a daemon of the same home on
 * another port cannot answer for whatever holds this one, and the prefix keeps the HMAC from ever meaning
 * anything else signed with the secret.
 */
export function machineProofMessage(port: number, nonce: string): string {
    return signedLines(SIGNING_PURPOSES.machineProof, [port, nonce]);
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
                if ('peer' in access) {
                    const { peer } = access;
                    return [
                        signal.sdp,
                        'peer',
                        peer.machineId,
                        peer.machinePublicKey,
                        peer.accountId,
                        peer.peerPublicKey,
                        peer.peerMachineId,
                        peer.peerMachinePublicKey,
                        peer.nonce,
                        peer.issuedAt,
                        peer.expiresAt,
                        peer.signature,
                        access.label
                    ];
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

// What a push's encryption authenticates besides its ciphertext: where it goes and how long it lives.
export function pushRoutingMessage(push: PushRouting): string {
    return signedBytes(SIGNING_PURPOSES.pushRouting, [push.machineId, push.handle, push.id, push.issuedAt, push.expiresAt, push.collapseId]);
}

/*
 * A machine answering a client at its door on the local network. The nonce is the client's, so an
 * answer recorded once proves nothing later, and the machine's id and key are in it, so a client that
 * pinned one machine never believes another one that happens to sit at the same private address.
 */
export function lanDoorMessage(nonce: string, machineId: string, publicKey: string): string {
    return signedBytes(SIGNING_PURPOSES.lanDoor, [nonce, machineId, publicKey]);
}

/*
 * What the maps service's HMAC covers: who the ticket is for and when it ends. The subject is a digest
 * of the account, so the service can count a ticket's requests without ever learning whose it is.
 */
export function mapsTicketBytes(subject: string, expiresAt: number): string {
    return signedBytes(SIGNING_PURPOSES.mapsTicketMac, [subject, expiresAt]);
}

/*
 * A machine asking to work in another one of its account, signed twice over these bytes: by the peer key,
 * which proves it holds the key the statement will name, and by the machine key, which proves it is that machine.
 */
export function peerAccessRequestMessage(machineId: string, peerPublicKey: string, peerMachineId: string, nonce: string): string {
    return signedBytes(SIGNING_PURPOSES.peerAccessRequest, [machineId, peerPublicKey, peerMachineId, nonce]);
}

/*
 * The address book vouching that one machine of an account may connect to another under a peer key. Both
 * machine keys and the account are in it, so a namesake machine on another account never fits.
 */
export function peerStatementMessage(
    machineId: string,
    machinePublicKey: string,
    accountId: string,
    peerPublicKey: string,
    peerMachineId: string,
    peerMachinePublicKey: string,
    nonce: string,
    issuedAt: number,
    expiresAt: number
): string {
    return signedBytes(SIGNING_PURPOSES.peerStatement, [
        machineId,
        machinePublicKey,
        accountId,
        peerPublicKey,
        peerMachineId,
        peerMachinePublicKey,
        nonce,
        issuedAt,
        expiresAt
    ]);
}
