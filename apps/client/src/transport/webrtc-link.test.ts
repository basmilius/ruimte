import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { channelBinding, PROTOCOL_VERSION, splitFrame, type DirectChallengeFrame } from '@ruimte/contracts';
import type { LinkEvents } from './link-transport';
import type { SignalingEvents } from './signaling';
import { webRtcLink, type WebRtcLinkOptions } from './webrtc-link';

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

    // A browser channel reports closed once the other end answered its stream reset; `silent` is one whose answer never comes.
    silent = false;

    close(): void {
        this.closed = true;
        if (this.silent) {
            return;
        }
        this.readyState = 'closed';
        this.onclose?.();
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
    // What the transport stats say arrived, which a test grows to stand for packets of a frame that is not whole yet.
    bytesReceived = 0;
    // The candidate pair in use and its two candidates, for a test about the path.
    pathEntries: Array<Record<string, unknown>> = [];

    async getStats(): Promise<Map<string, Record<string, unknown>>> {
        return new Map([
            ['T01', { type: 'transport', bytesReceived: this.bytesReceived, ...(this.pathEntries.length > 0 ? { selectedCandidatePairId: 'P01' } : {}) }],
            ...this.pathEntries.map((entry): [string, Record<string, unknown>] => [String(entry.id), entry])
        ]);
    }

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

// Fake timers leave setImmediate alone, so this drains every pending promise without letting a timer run.
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// Each step runs the timers due in that millisecond, then every promise they started.
const sleep = async (ms: number): Promise<void> => {
    for (let i = 0; i < ms; i++) {
        jest.advanceTimersByTime(1);
        await tick();
    }
};

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

const setup = (extra: Partial<WebRtcLinkOptions> = {}) => {
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
        accepted: (ticket) => tickets.push(ticket),
        ...extra
    })('ws://machine/ws?token=ticket', events);
    return { socket, peer, link, proved, tickets, log };
};

const CHALLENGE: DirectChallengeFrame = {
    type: 'direct.challenge',
    protocol: PROTOCOL_VERSION,
    challenge: 'nonce',
    daemon: { id: 'daemon-a', publicKey: 'key', signature: 'signature' }
};

/* Everything up to the moment the daemon has answered the offer. */
const negotiated = async (extra: Partial<WebRtcLinkOptions> = {}) => {
    const context = setup(extra);
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

const pathThrough = (localType: string): Array<Record<string, unknown>> => [
    { id: 'P01', type: 'candidate-pair', localCandidateId: 'L01', remoteCandidateId: 'R01' },
    { id: 'L01', type: 'local-candidate', candidateType: localType },
    { id: 'R01', type: 'remote-candidate', candidateType: 'srflx' }
];

describe('webRtcLink and the relay', () => {
    test('the servers a route hands out join the own ones of this client, and the path of the open channel is reported as it changes', async () => {
        const turn = { urls: ['turn:turn.example.com:3478?transport=udp'], username: '1:c-x', credential: 'y' };
        const configurations: RTCConfiguration[] = [];
        let routeEvents: SignalingEvents | null = null;
        const sent: Array<{ kind: string }> = [];
        const peer = new FakePeer();
        const routes: boolean[] = [];
        const opened: number[] = [];
        webRtcLink({
            iceServers: [{ urls: ['stun:turn.ruimte.app:3478'] }],
            timeoutMs: 60_000,
            pingTickMs: 10,
            createPeer: (configuration) => {
                configurations.push(configuration);
                return peer as unknown as RTCPeerConnection;
            },
            signaling: () => (_connectionId, events) => {
                routeEvents = events;
                queueMicrotask(() => events.ready([turn]));
                return { send: (signal) => sent.push(signal), close: () => undefined };
            },
            prove: async (challenge) => ({ type: 'direct.secret', challenge: challenge.challenge, proof: 'proof' })
        })('wss://broker.example.com', {
            open: () => opened.push(1),
            message: () => undefined,
            close: () => undefined,
            route: (relayed) => routes.push(relayed)
        });
        await tick();
        expect(configurations).toEqual([{ iceServers: [{ urls: ['stun:turn.ruimte.app:3478'] }, turn] }]);
        expect(sent.map((signal) => signal.kind)).toEqual(['offer']);

        routeEvents!.signal({ kind: 'answer', sdp: ANSWER });
        await tick();
        peer.channel.deliver(CHALLENGE);
        await tick();
        peer.channel.deliver({ type: 'direct.accepted', ticket: null, expiresIn: 1000 });
        await tick();
        expect(opened).toHaveLength(1);

        peer.pathEntries = pathThrough('relay');
        await sleep(10);
        expect(routes).toEqual([true]);
        // The same path again is no news.
        await sleep(10);
        expect(routes).toEqual([true]);
        peer.pathEntries = pathThrough('host');
        await sleep(10);
        expect(routes).toEqual([true, false]);
    });
});

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

    test('a daemon from before versions is refused as older, before anything is proved', async () => {
        const { peer, proved, log } = await negotiated();
        const { protocol: _protocol, ...unversioned } = CHALLENGE;
        peer.channel.deliver(unversioned);
        await tick();
        expect(proved).toEqual([]);
        expect(log.opened).toBe(0);
        expect(log.closes).toEqual(['This machine runs an older Ruimte. Update Ruimte there, or restart it to pick up the update.']);
    });

    test('a refusal about the version says which side is behind', async () => {
        const { peer, log } = await negotiated();
        peer.channel.deliver(CHALLENGE);
        await tick();
        peer.channel.deliver({ type: 'direct.refused', reason: 'different versions', protocol: PROTOCOL_VERSION + 1 });
        await tick();
        expect(log.closes).toEqual(['This machine runs a newer Ruimte than this app. Update this app.']);
    });

    test('closing an open link takes the peer down only after the channel closed, or after the grace', async () => {
        const { peer, link, log } = await negotiated();
        peer.channel.deliver(CHALLENGE);
        await tick();
        peer.channel.deliver({ type: 'direct.accepted', ticket: null, expiresIn: 1000 });
        await tick();
        peer.channel.silent = true;
        link.close();
        expect(log.closes).toEqual([null]);
        expect(peer.channel.closed).toBe(true);
        // The machine hears the close through the channel's stream reset, which a peer closed first can cut off.
        expect(peer.closed).toBe(false);
        peer.channel.readyState = 'closed';
        peer.channel.onclose?.();
        expect(peer.closed).toBe(true);
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

    test('a machine that goes quiet after the handshake is pinged, and ends the link when nothing answers', async () => {
        const { peer, log } = await negotiated({ pingIdleMs: 10, pingTimeoutMs: 40, pingTickMs: 5 });
        peer.channel.deliver(CHALLENGE);
        await tick();
        peer.channel.deliver({ type: 'direct.accepted', ticket: null, expiresIn: null });
        await tick();
        await sleep(30);
        expect(peer.channel.sent.some((piece) => piece.includes('"server.ping"'))).toBe(true);
        expect(log.closes).toEqual([]);
        await sleep(80);
        expect(log.closes).toEqual(['The machine stopped answering over the direct connection']);
    });

    test('a machine that keeps talking is never taken for gone', async () => {
        const { peer, log } = await negotiated({ pingIdleMs: 10, pingTimeoutMs: 20, pingTickMs: 5 });
        peer.channel.deliver(CHALLENGE);
        await tick();
        peer.channel.deliver({ type: 'direct.accepted', ticket: null, expiresIn: null });
        await tick();
        const chatter = setInterval(() => peer.channel.deliver('{"type":"event","event":"session.list-changed","payload":{}}'), 3);
        await sleep(100);
        clearInterval(chatter);
        expect(log.closes).toEqual([]);
        expect(peer.channel.sent.some((piece) => piece.includes('"server.ping"'))).toBe(false);
    });

    test('a machine whose frames are stuck behind a burst is not taken for gone while its packets still arrive', async () => {
        const { peer, log } = await negotiated({ pingIdleMs: 10, pingTimeoutMs: 40, pingTickMs: 5 });
        peer.channel.deliver(CHALLENGE);
        await tick();
        peer.channel.deliver({ type: 'direct.accepted', ticket: null, expiresIn: null });
        await tick();
        // No piece arrives for three times the timeout, as on an ordered channel waiting for a retransmission.
        const packets = setInterval(() => {
            peer.bytesReceived += 1_200;
        }, 3);
        await sleep(150);
        clearInterval(packets);
        expect(log.closes).toEqual([]);
        await sleep(150);
        expect(log.closes).toEqual(['The machine stopped answering over the direct connection']);
    });

    test('another signaling route carries the offer and the answer, opens no socket, and is closed once the channel is in', async () => {
        const opened: string[] = [];
        const sent: unknown[] = [];
        let closed = 0;
        let deliver: ((signal: { kind: 'answer'; sdp: string }) => void) | null = null;
        const { peer, log } = setup({
            createSocket: () => {
                throw new Error('No socket should be opened');
            },
            signaling: (url) => (connectionId, events) => {
                opened.push(`${url} ${connectionId.length > 0}`);
                deliver = events.signal;
                queueMicrotask(() => events.ready());
                return {
                    send: (signal) => sent.push(signal),
                    close: () => {
                        closed += 1;
                    }
                };
            }
        });
        await tick();
        await tick();
        expect(opened).toEqual(['ws://machine/ws?token=ticket true']);
        expect(sent).toEqual([{ kind: 'offer', sdp: OFFER }]);
        deliver!({ kind: 'answer', sdp: ANSWER });
        await tick();
        expect(peer.remoteDescription?.sdp).toBe(ANSWER);
        peer.channel.deliver(CHALLENGE);
        await tick();
        peer.channel.deliver({ type: 'direct.accepted', ticket: null, expiresIn: null });
        await tick();
        expect(log.opened).toBe(1);
        expect(closed).toBe(1);
    });

    test('a machine that does not know the key says so through the signals, and a route that fails ends the link', async () => {
        const refused = setup({
            signaling: () => (_connectionId, events) => {
                queueMicrotask(() => events.signal({ kind: 'close', reason: 'not-paired' }));
                return { send: () => undefined, close: () => undefined };
            }
        });
        await tick();
        expect(refused.log.closes).toEqual(['The machine does not know this client. Its access was revoked, or it lost the pairing; pair again to connect.']);

        const failed = setup({
            signaling: () => (_connectionId, events) => {
                events.fail('The broker at broker.example.com could not be reached');
                return { send: () => undefined, close: () => undefined };
            }
        });
        expect(failed.log.closes).toEqual(['The broker at broker.example.com could not be reached']);
    });
});
