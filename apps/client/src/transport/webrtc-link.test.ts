import { describe, expect, test } from 'bun:test';
import { channelBinding, splitFrame, type DirectChallengeFrame } from '@ruimte/contracts';
import type { LinkEvents } from './link-transport';
import { webRtcLink } from './webrtc-link';

const OFFER = 'v=0\r\na=fingerprint:sha-256 AA:AA\r\n';
const ANSWER = 'v=0\r\na=fingerprint:sha-256 BB:BB\r\n';

class FakeSocket {
    readonly sent: string[] = [];
    closed = false;
    onopen: (() => void) | null = null;
    onmessage: ((message: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;

    send(data: string): void {
        this.sent.push(data);
    }

    close(): void {
        this.closed = true;
    }

    event(event: string, payload: unknown): void {
        this.onmessage?.({ data: JSON.stringify({ type: 'event', event, payload }) });
    }
}

class FakeChannel {
    readonly sent: string[] = [];
    readyState = 'open';
    closed = false;
    onmessage: ((message: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;

    send(data: string): void {
        this.sent.push(data);
    }

    close(): void {
        this.closed = true;
    }

    deliver(frame: unknown): void {
        for (const piece of splitFrame(typeof frame === 'string' ? frame : JSON.stringify(frame))) {
            this.onmessage?.({ data: piece });
        }
    }
}

class FakePeer {
    readonly channel = new FakeChannel();
    localDescription: { sdp: string } | null = null;
    remoteDescription: { sdp: string } | null = null;
    iceGatheringState = 'complete';
    connectionState = 'new';
    closed = false;
    onconnectionstatechange: (() => void) | null = null;

    createDataChannel(): FakeChannel {
        return this.channel;
    }

    async createOffer(): Promise<{ type: string; sdp: string }> {
        return { type: 'offer', sdp: OFFER };
    }

    async setLocalDescription(description: { sdp: string }): Promise<void> {
        this.localDescription = description;
    }

    async setRemoteDescription(description: { sdp: string }): Promise<void> {
        this.remoteDescription = description;
    }

    async addIceCandidate(): Promise<void> {}

    addEventListener(): void {}

    removeEventListener(): void {}

    close(): void {
        this.closed = true;
    }

    fail(): void {
        this.connectionState = 'failed';
        this.onconnectionstatechange?.();
    }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const setup = () => {
    const socket = new FakeSocket();
    const peer = new FakePeer();
    const proved: Array<{ challenge: DirectChallengeFrame; binding: string }> = [];
    const tickets: Array<string | null> = [];
    const log: { opened: number; messages: string[]; closes: Array<string | null> } = { opened: 0, messages: [], closes: [] };
    const events: LinkEvents = {
        open: () => {
            log.opened += 1;
        },
        message: (data) => log.messages.push(data),
        close: (failure) => log.closes.push(failure)
    };
    const link = webRtcLink({
        iceServers: [],
        timeoutMs: 60_000,
        createSocket: () => socket as unknown as WebSocket,
        createPeer: () => peer as unknown as RTCPeerConnection,
        prove: async (challenge, binding) => {
            proved.push({ challenge, binding });
            return { type: 'direct.secret', challenge: challenge.challenge, proof: 'proof' };
        },
        accepted: (ticket) => tickets.push(ticket)
    })('ws://machine/ws?token=ticket', events);
    return { socket, peer, link, proved, tickets, log };
};

const CHALLENGE: DirectChallengeFrame = { type: 'direct.challenge', challenge: 'nonce', daemon: { id: 'daemon-a', publicKey: 'key', signature: 'signature' } };

/* Everything up to the moment the daemon has answered the offer. */
const negotiated = async () => {
    const context = setup();
    context.socket.onopen?.();
    await tick();
    const offer = JSON.parse(context.socket.sent[0]!) as {
        type: string;
        payload: { envelope: { connectionId: string; signal: { kind: string; sdp: string } } };
    };
    context.socket.event('direct.signaled', { envelope: { connectionId: offer.payload.envelope.connectionId, signal: { kind: 'answer', sdp: ANSWER } } });
    await tick();
    return { ...context, offer };
};

describe('webRtcLink', () => {
    test('the offer goes out over the socket, and the channel opens only once the handshake is through', async () => {
        const { socket, peer, proved, tickets, log, offer, link } = await negotiated();
        expect(offer.type).toBe('direct.signal');
        expect(offer.payload.envelope.signal).toEqual({ kind: 'offer', sdp: OFFER });
        expect(peer.remoteDescription?.sdp).toBe(ANSWER);

        peer.channel.deliver(CHALLENGE);
        await tick();
        expect(proved).toEqual([{ challenge: CHALLENGE, binding: channelBinding(OFFER, ANSWER) }]);
        expect(peer.channel.sent).toEqual(splitFrame(JSON.stringify({ type: 'direct.secret', challenge: 'nonce', proof: 'proof' })));
        expect(log.opened).toBe(0);

        peer.channel.deliver({ type: 'direct.accepted', ticket: 'ticket-2', expiresIn: 1000 });
        await tick();
        expect(log.opened).toBe(1);
        expect(tickets).toEqual(['ticket-2']);
        // The socket was only for the signals; the channel carries on without it.
        expect(socket.closed).toBe(true);

        peer.channel.deliver('{"type":"event","event":"session.list-changed","payload":{}}');
        expect(log.messages).toEqual(['{"type":"event","event":"session.list-changed","payload":{}}']);
        const large = JSON.stringify({ id: '1', type: 'session.write', payload: { data: 'x'.repeat(40_000) } });
        link.send(large);
        expect(peer.channel.sent.slice(-3)).toEqual(splitFrame(large));
    });

    test('nothing the client sends travels before the daemon let it in', async () => {
        const { peer, link } = await negotiated();
        link.send('{"id":"1","type":"session.list","payload":{}}');
        expect(peer.channel.sent).toEqual([]);
    });

    test('a refusal ends the link with the machine reason and never opens it', async () => {
        const { peer, log } = await negotiated();
        peer.channel.deliver(CHALLENGE);
        await tick();
        peer.channel.deliver({ type: 'direct.refused', reason: 'That is not the secret of this machine' });
        await tick();
        expect(log.opened).toBe(0);
        expect(log.closes).toEqual(['The machine refused the direct connection: That is not the secret of this machine']);
        expect(peer.closed).toBe(true);
    });

    test('ICE failing is said in so many words', async () => {
        const { peer, log } = await negotiated();
        peer.fail();
        expect(log.closes).toHaveLength(1);
        expect(log.closes[0]).toContain('ICE failed');
    });

    test('a daemon that does not know the request says so, and an answer for another attempt is ignored', async () => {
        const { socket, peer, log } = setup();
        socket.onopen?.();
        await tick();
        socket.event('direct.signaled', { envelope: { connectionId: 'someone-else-entirely', signal: { kind: 'answer', sdp: ANSWER } } });
        expect(peer.remoteDescription).toBeNull();
        socket.onmessage?.({
            data: JSON.stringify({ id: 'direct-1', ok: false, error: { code: 'unknown-request', message: 'Unknown request type: direct.signal' } })
        });
        expect(log.closes).toEqual(['The machine did not take the direct connection: Unknown request type: direct.signal']);
    });

    test('a signaling socket that closes before the channel is in is a failure; closing the link is not', async () => {
        const first = setup();
        first.socket.onclose?.();
        expect(first.log.closes).toEqual(['The machine could not be reached to set up a direct connection']);

        const second = await negotiated();
        second.link.close();
        second.link.close();
        expect(second.log.closes).toEqual([null]);
    });
});
