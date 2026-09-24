import { describe, expect, test } from 'bun:test';
import type { IceServer, SignalEnvelope } from '@ruimte/pulsar';
import type { RTCPeerConnection } from 'werift';
import { DirectPeers } from './peers.ts';

/* Just enough of werift's peer connection for an offer to be tried and to fail before any network is touched. */
class FakePeer {
    readonly configuration: unknown;
    closed = false;

    constructor(configuration: unknown) {
        this.configuration = configuration;
    }

    readonly connectionStateChange = { subscribe: () => ({ unSubscribe: () => undefined }) };
    readonly onDataChannel = { subscribe: () => ({ unSubscribe: () => undefined }) };

    async setRemoteDescription(): Promise<void> {
        throw new Error('no network in a unit test');
    }

    async close(): Promise<void> {
        this.closed = true;
    }
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('DirectPeers', () => {
    test('asks for the ICE servers on every offer, so an attempt gets the credentials that are current then', async () => {
        const peersMade: FakePeer[] = [];
        let servers: IceServer[] = [{ urls: 'stun:stun.example.com:3478' }];
        const peers = new DirectPeers({
            iceServers: () => servers,
            portRange: [43100, 43199],
            hostAddresses: [],
            authenticate: async () => null,
            open: () => undefined,
            log: { log: () => undefined, warn: () => undefined },
            createPeer: (configuration) => {
                const peer = new FakePeer(configuration);
                peersMade.push(peer);
                return peer as unknown as RTCPeerConnection;
            }
        });
        const replies: SignalEnvelope[] = [];
        peers.receive({ connectionId: 'attempt-1', signal: { kind: 'offer', sdp: 'v=0' } }, (reply) => replies.push(reply));
        servers = [{ urls: 'stun:stun.example.com:3478' }, { urls: 'turn:turn.example.com:3478?transport=udp', username: '2:m-x', credential: 'fresh' }];
        peers.receive({ connectionId: 'attempt-2', signal: { kind: 'offer', sdp: 'v=0' } }, (reply) => replies.push(reply));
        await settle();

        expect(peersMade.map((peer) => (peer.configuration as { iceServers: IceServer[] }).iceServers)).toEqual([
            [{ urls: 'stun:stun.example.com:3478' }],
            [{ urls: 'stun:stun.example.com:3478' }, { urls: 'turn:turn.example.com:3478?transport=udp', username: '2:m-x', credential: 'fresh' }]
        ]);
        expect((peersMade[0]!.configuration as { icePortRange: unknown }).icePortRange).toEqual([43100, 43199]);
        // Both failed before any network, and each says so to its own client.
        expect(replies).toEqual([
            { connectionId: 'attempt-1', signal: { kind: 'close', reason: 'failed' } },
            { connectionId: 'attempt-2', signal: { kind: 'close', reason: 'failed' } }
        ]);
        expect(peers.size).toBe(0);
        expect(peersMade.every((peer) => peer.closed)).toBe(true);
    });

    test('an offer that throws before its attempt exists is logged, not left to end the daemon', async () => {
        const warnings: string[] = [];
        const peers = new DirectPeers({
            iceServers: () => {
                throw new Error('the broker switch broke');
            },
            portRange: null,
            hostAddresses: [],
            authenticate: async () => null,
            open: () => undefined,
            log: { log: () => undefined, warn: (...parts: unknown[]) => warnings.push(parts.join(' ')) },
            createPeer: (configuration) => new FakePeer(configuration) as unknown as RTCPeerConnection
        });
        peers.receive({ connectionId: 'attempt-3', signal: { kind: 'offer', sdp: 'v=0' } }, () => undefined);
        await settle();

        expect(warnings).toEqual(['Answering a direct connection failed: the broker switch broke']);
        expect(peers.size).toBe(0);
    });
});
