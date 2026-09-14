import { describe, expect, test } from 'bun:test';
import { BrokerPeer, brokerHostOf, brokerHelloMessage, signalMessage, type BrokerPeerEvents } from './index.ts';

const key = 'A'.repeat(43);
const otherKey = 'B'.repeat(43);
const signature = 's'.repeat(86);
const nonce = 'n'.repeat(22);

const setup = (host = 'broker.example.com') => {
    const sent: unknown[] = [];
    const signed: string[] = [];
    const log = { ready: 0, relayed: [] as unknown[], refused: [] as unknown[], failed: [] as string[] };
    const events: BrokerPeerEvents = {
        ready: () => {
            log.ready += 1;
        },
        relayed: (frame) => log.relayed.push(frame),
        refused: (frame) => log.refused.push(frame),
        failed: (reason) => log.failed.push(reason)
    };
    const peer = new BrokerPeer({
        role: 'client',
        publicKey: key,
        host,
        sign: (message) => {
            signed.push(message);
            return signature;
        },
        send: (frame) => sent.push(JSON.parse(frame)),
        events
    });
    return { peer, sent, signed, log };
};

describe('BrokerPeer', () => {
    test('announces, answers the challenge over the broker host and signs every relay end to end', async () => {
        const { peer, sent, signed, log } = setup();
        peer.start();
        expect(sent).toEqual([{ type: 'hello', role: 'client', publicKey: key }]);
        expect(await peer.relay(otherKey, { connectionId: 'attempt-1', signal: { kind: 'close', reason: 'done' } })).toBeNull();

        await peer.receive(JSON.stringify({ type: 'challenge', broker: 'broker.example.com', nonce }));
        expect(signed).toEqual([brokerHelloMessage('broker.example.com', 'client', key, nonce)]);
        expect(sent[1]).toEqual({ type: 'prove', signature });

        await peer.receive(JSON.stringify({ type: 'ready' }));
        expect(log.ready).toBe(1);
        const envelope = { connectionId: 'attempt-1', signal: { kind: 'offer' as const, sdp: 'v=0' } };
        const id = await peer.relay(otherKey, envelope);
        expect(sent[2]).toEqual({ type: 'relay', id, to: otherKey, envelope, signature });
        expect(signed[1]).toBe(signalMessage(key, otherKey, envelope));
    });

    test('a challenge for another host is a failure, and nothing is signed for it', async () => {
        const { peer, signed, log } = setup('127.0.0.1:4400');
        peer.start();
        await peer.receive(JSON.stringify({ type: 'challenge', broker: 'elsewhere.example.com', nonce }));
        expect(signed).toEqual([]);
        expect(log.failed).toEqual(['The broker at 127.0.0.1:4400 calls itself elsewhere.example.com']);
    });

    test('relays and refusals reach the events; a frame that does not parse ends the peer', async () => {
        const { peer, log } = setup();
        peer.start();
        await peer.receive(JSON.stringify({ type: 'challenge', broker: 'broker.example.com', nonce }));
        await peer.receive(JSON.stringify({ type: 'ready' }));
        const relayed = { type: 'relayed', from: otherKey, envelope: { connectionId: 'attempt-1', signal: { kind: 'answer', sdp: 'v=0' } }, signature };
        await peer.receive(JSON.stringify(relayed));
        await peer.receive(JSON.stringify({ type: 'error', code: 'not-connected', message: 'Nobody', id: 'relay-1' }));
        expect(log.relayed).toEqual([relayed]);
        expect(log.refused).toEqual([{ type: 'error', code: 'not-connected', message: 'Nobody', id: 'relay-1' }]);

        await peer.receive('{"type":"surprise"}');
        expect(log.failed).toHaveLength(1);
        await peer.receive(JSON.stringify(relayed));
        expect(log.relayed).toHaveLength(1);
    });

    test('the host of a URL is what a broker names', () => {
        expect(brokerHostOf('wss://broker.example.com/')).toBe('broker.example.com');
        expect(brokerHostOf('ws://127.0.0.1:4400')).toBe('127.0.0.1:4400');
    });
});
