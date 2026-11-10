import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import {
    PUSH_HKDF_SALT,
    accessRequestMessage,
    accessStatementMessage,
    accessStatementV2Message,
    brokerHelloMessage,
    clientAuthMessage,
    clientChannelMessage,
    daemonChallengeMessage,
    daemonChannelMessage,
    deviceLinkStartMessage,
    extensionStoreMessage,
    lanDoorMessage,
    localSecretChannelMessage,
    machineProofMessage,
    machineRegistrationMessage,
    mapsTicketBytes,
    mapsTicketSubject,
    peerAccessRequestMessage,
    peerStatementMessage,
    pushMessage,
    pushRoutingMessage,
    sessionKeyMessage,
    sessionRefreshMessage,
    signMapsPath,
    signMapsTicket,
    signalMessage,
    type PushEnvelope
} from './index.ts';

/*
 * The exact bytes every signed, MACed or key-deriving message produced when these vectors were taken from
 * the code before the prefixes moved into one table. A change to a prefix, a field or its order shows up
 * here, since a signature made under the old bytes would stop verifying.
 */
const key = 'A'.repeat(43);
const otherKey = 'B'.repeat(43);
const nonce = 'n'.repeat(22);
const binding = '[["sha-256 AA"],["sha-256 BB"]]';
const mapsSecret = 'M'.repeat(43);

const statement = { machineId: 'machine-1', clientPublicKey: key, nonce, issuedAt: 0, expiresAt: 120_000, signature: 's'.repeat(86) };
const peer = {
    machineId: 'machine-1',
    machinePublicKey: key,
    accountId: 'account-1',
    peerPublicKey: otherKey,
    peerMachineId: 'machine-2',
    peerMachinePublicKey: key,
    nonce,
    issuedAt: 0,
    expiresAt: 600_000,
    signature: 's'.repeat(86)
};
const routing = { machineId: 'machine-1', handle: key, id: otherKey, issuedAt: 0, expiresAt: 120_000, collapseId: key };
const alert: PushEnvelope = { ...routing, pushType: 'alert', ephemeralKey: key, nonce: 'n'.repeat(16), ciphertext: 'c'.repeat(22), signature: 's'.repeat(86) };
const liveActivity: PushEnvelope = {
    ...routing,
    pushType: 'liveactivity',
    signature: 's'.repeat(86),
    activity: {
        title: 'Build',
        phase: 'needs-you',
        startedAt: 5,
        runningCount: 2,
        attentionCount: 1,
        agents: [
            { nodeId: 'n1', target: 'chat', title: 'Agent', phase: 'running', startedAt: 7 },
            { nodeId: 'n2', target: 'terminal', title: 'Other', phase: 'needs-you' }
        ]
    }
};

const VECTORS: [string, () => string, string][] = [
    [
        'brokerHello',
        () => brokerHelloMessage('broker.example.com', 'machine', key, nonce),
        'pulsar-broker-hello-v1\n["broker.example.com","machine","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","nnnnnnnnnnnnnnnnnnnnnn"]'
    ],
    [
        'signalClose',
        () => signalMessage(key, otherKey, { connectionId: 'attempt-1', signal: { kind: 'close', reason: 'done' } }),
        'pulsar-signal-v1\n["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB","attempt-1","close","done"]'
    ],
    [
        'signalAnswer',
        () => signalMessage(key, otherKey, { connectionId: 'attempt-1', signal: { kind: 'answer', sdp: 'v=0' } }),
        'pulsar-signal-v1\n["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB","attempt-1","answer","v=0"]'
    ],
    [
        'signalCandidate',
        () =>
            signalMessage(key, otherKey, { connectionId: 'attempt-1', signal: { kind: 'candidate', candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 } }),
        'pulsar-signal-v1\n["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB","attempt-1","candidate","candidate:1","0",0]'
    ],
    [
        'signalOffer',
        () => signalMessage(key, otherKey, { connectionId: 'attempt-1', signal: { kind: 'offer', sdp: 'v=0' } }),
        'pulsar-signal-v1\n["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB","attempt-1","offer","v=0"]'
    ],
    [
        'signalOfferStatement',
        () => signalMessage(key, otherKey, { connectionId: 'attempt-1', signal: { kind: 'offer', sdp: 'v=0', access: { statement, label: 'Laptop' } } }),
        'pulsar-signal-v1\n["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB","attempt-1","offer","v=0","machine-1","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","nnnnnnnnnnnnnnnnnnnnnn",0,120000,"ssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss","Laptop"]'
    ],
    [
        'signalOfferPeer',
        () => signalMessage(key, otherKey, { connectionId: 'attempt-1', signal: { kind: 'offer', sdp: 'v=0', access: { peer, label: 'Laptop' } } }),
        'pulsar-signal-v1\n["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB","attempt-1","offer","v=0","peer","machine-1","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","account-1","BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB","machine-2","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","nnnnnnnnnnnnnnnnnnnnnn",0,600000,"ssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss","Laptop"]'
    ],
    [
        'machineRegistration',
        () => machineRegistrationMessage('account-1', 'machine-1', key, 'machine', 0),
        'pulsar-machine-registration-v1\n["account-1","machine-1","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","machine",0]'
    ],
    [
        'accessRequest',
        () => accessRequestMessage('machine-1', key, nonce),
        'pulsar-access-request-v1\n["machine-1","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","nnnnnnnnnnnnnnnnnnnnnn"]'
    ],
    [
        'accessStatement',
        () => accessStatementMessage('machine-1', key, nonce, 0, 120_000),
        'pulsar-access-statement-v1\n["machine-1","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","nnnnnnnnnnnnnnnnnnnnnn",0,120000]'
    ],
    [
        'accessStatementV2',
        () => accessStatementV2Message('machine-1', key, 'account-1', otherKey, nonce, 0, 120_000),
        'pulsar-access-statement-v2\n["machine-1","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","account-1","BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB","nnnnnnnnnnnnnnnnnnnnnn",0,120000]'
    ],
    ['sessionKey', () => sessionKeyMessage('code-1', key), 'pulsar-session-key-v1\n["code-1","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]'],
    ['sessionRefresh', () => sessionRefreshMessage('refresh-1', 0), 'pulsar-session-refresh-v1\n["refresh-1",0]'],
    [
        'deviceLinkStart',
        () => deviceLinkStartMessage('machine-1', key, 'machine', 0),
        'pulsar-device-link-start-v1\n["machine-1","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","machine",0]'
    ],
    [
        'pushAlert',
        () => pushMessage(alert),
        'pulsar-push-v1\n["machine-1","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",0,120000,"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","alert","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","nnnnnnnnnnnnnnnn","cccccccccccccccccccccc"]'
    ],
    [
        'pushLive',
        () => pushMessage(liveActivity),
        'pulsar-push-v1\n["machine-1","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",0,120000,"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","liveactivity","Build","needs-you",5,2,1,2,"n1","chat","Agent","running",7,"n2","terminal","Other","needs-you"]'
    ],
    [
        'pushRouting',
        () => pushRoutingMessage(routing),
        'pulsar-push-routing-v1\n["machine-1","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",0,120000,"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]'
    ],
    ['pushHkdfSalt', () => PUSH_HKDF_SALT, 'pulsar-push-encryption-v1'],
    [
        'lanDoor',
        () => lanDoorMessage(nonce, 'machine-1', key),
        'pulsar-lan-door-v1\n["nnnnnnnnnnnnnnnnnnnnnn","machine-1","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]'
    ],
    ['mapsTicketBytes', () => mapsTicketBytes(key, 3_600_000), 'pulsar-maps-ticket-mac-v1\n["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",3600000]'],
    [
        'peerAccessRequest',
        () => peerAccessRequestMessage('machine-1', key, 'machine-2', nonce),
        'pulsar-peer-access-request-v1\n["machine-1","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","machine-2","nnnnnnnnnnnnnnnnnnnnnn"]'
    ],
    [
        'peerStatement',
        () => peerStatementMessage('machine-1', key, 'account-1', otherKey, 'machine-2', key, nonce, 0, 600_000),
        'pulsar-peer-statement-v1\n["machine-1","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","account-1","BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB","machine-2","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","nnnnnnnnnnnnnnnnnnnnnn",0,600000]'
    ],
    ['extensionStore', () => extensionStoreMessage('{"index":1}'), 'ruimte-extension-store-v1\n{"index":1}'],
    ['daemonChallenge', () => daemonChallengeMessage('daemon-1', 'challenge-1'), 'ruimte-daemon-v1\ndaemon-1\nchallenge-1'],
    [
        'clientAuth',
        () => clientAuthMessage('daemon-1', 'challenge-1', key),
        'ruimte-client-v1\ndaemon-1\nchallenge-1\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    ],
    [
        'daemonChannel',
        () => daemonChannelMessage('daemon-1', 'challenge-1', binding),
        'ruimte-daemon-channel-v1\ndaemon-1\nchallenge-1\n[["sha-256 AA"],["sha-256 BB"]]'
    ],
    [
        'clientChannel',
        () => clientChannelMessage('daemon-1', 'challenge-1', key, binding),
        'ruimte-client-channel-v1\ndaemon-1\nchallenge-1\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n[["sha-256 AA"],["sha-256 BB"]]'
    ],
    [
        'localChannel',
        () => localSecretChannelMessage('daemon-1', 'challenge-1', binding),
        'ruimte-local-channel-v1\ndaemon-1\nchallenge-1\n[["sha-256 AA"],["sha-256 BB"]]'
    ]
];

describe('signed bytes vectors', () => {
    test.each(VECTORS)('%s', (_name, actual, expected) => {
        expect(actual()).toBe(expected);
    });

    test('the local secret HMACs cover exactly these bytes', () => {
        expect(
            createHmac('sha256', 'the-secret')
                .update(localSecretChannelMessage('daemon-1', 'challenge-1', binding))
                .digest('base64url')
        ).toBe('Nks32iUKVQ1xJO4H1QgwDFnW8kYkHrEZY84YJ-gyp34');
        expect(createHmac('sha256', 'the-secret').update(machineProofMessage(4210, 'nonce-of-the-shell')).digest('base64url')).toBe(
            'reh8IrOqRUz1pMPEoxQbB8SDG0rkGl1WHXmxVyY7ySs'
        );
    });

    test('the maps secret derives these keys and marks', async () => {
        const subject = await mapsTicketSubject(mapsSecret, 'account-1');
        expect(subject).toBe('HctpWB6hdvb_ovhSATho5g16UsbhwiG-CBvMcvfZ4Oc');
        expect(await signMapsPath(mapsSecret, '/style/main.json')).toBe('lqLcB0sNrYZ2CwbxmWyuBYsHf97crCMHI8JVygkFVak');
        expect((await signMapsTicket(mapsSecret, subject, 3_600_000)).ticket).toBe(
            'HctpWB6hdvb_ovhSATho5g16UsbhwiG-CBvMcvfZ4Oc.3600000.sqLnP-oLUbCBu_BIXqG1C4tYqC5zzxf3rXax6PFx4KA'
        );
    });
});
