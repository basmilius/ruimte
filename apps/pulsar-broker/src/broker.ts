import { randomBytes } from 'node:crypto';
import { BrokerPeerFrameSchema, brokerHelloMessage, type BrokerRole, type BrokerServerFrame } from '@ruimte/pulsar';
import type { BrokerLimits } from './config.ts';
import { verifySignature } from '@ruimte/pulsar/verify-node';
import { RateLimiter } from './rate-limit.ts';
import { noTurn, type TurnProvider } from './turn.ts';

/* What the broker needs of a socket, so the rules can be tested without one. */
export interface PeerSocket {
    send(frame: string): void;
    close(code: number, reason: string): void;
    ping(): void;
}

// Close codes a peer can tell apart; the 4000 range is the application's own.
export const CLOSE = {
    tooLarge: 1009,
    badFrame: 4002,
    badSignature: 4003,
    timeout: 4008,
    replaced: 4009,
    rateLimited: 4029
} as const;

export class Peer {
    readonly socket: PeerSocket;
    readonly ip: string;
    /* The host this peer dialed, which is what it signs. */
    readonly name: string;
    readonly openedAt: number;
    state: 'new' | 'challenged' | 'ready' | 'closed' = 'new';
    role: BrokerRole | null = null;
    publicKey: string | null = null;
    nonce: string | null = null;
    lastHeardAt: number;
    lastPingAt: number;

    constructor(socket: PeerSocket, ip: string, name: string, now: number) {
        this.socket = socket;
        this.ip = ip;
        this.name = name;
        this.openedAt = now;
        this.lastHeardAt = now;
        this.lastPingAt = now;
    }
}

export interface Admission {
    message: string;
    retryAfterMs: number;
}

/*
 * The whole broker: which key sits on which socket, and a signal from one to another. It holds no
 * account, no name and nothing on disk, and it never opens an envelope; the receiver checks the
 * sender's signature, because the receiver is the one a lying broker would be lying to.
 */
export class Broker {
    private readonly limits: BrokerLimits;
    private readonly now: () => number;
    private readonly peers = new Set<Peer>();
    private readonly announced = new Map<string, Peer>();
    private readonly socketsPerIp = new Map<string, number>();
    private readonly connections: RateLimiter;
    private readonly frames: RateLimiter;
    private readonly relays: RateLimiter;
    private readonly announcements: RateLimiter;
    private readonly iceRequests: RateLimiter;
    private readonly turn: TurnProvider;
    private readonly log: Pick<Console, 'warn'>;

    constructor(limits: BrokerLimits, now: () => number = Date.now, turn: TurnProvider = noTurn, log: Pick<Console, 'warn'> = console) {
        this.limits = limits;
        this.now = now;
        this.turn = turn;
        this.log = log;
        this.iceRequests = new RateLimiter(limits.iceRequestsPerMinutePerKey, 60_000, now);
        this.connections = new RateLimiter(limits.connectionsPerMinutePerIp, 60_000, now);
        this.frames = new RateLimiter(limits.framesPerSecondPerIp, 1_000, now);
        this.relays = new RateLimiter(limits.relaysPerMinutePerKey, 60_000, now);
        this.announcements = new RateLimiter(limits.announcesPerMinutePerKey, 60_000, now);
    }

    get counts(): { sockets: number; machines: number; clients: number } {
        const roles = [...this.announced.values()].map((peer) => peer.role);
        return {
            sockets: this.peers.size,
            machines: roles.filter((role) => role === 'machine').length,
            clients: roles.filter((role) => role === 'client').length
        };
    }

    /* Asked before a socket is upgraded; null lets it in. */
    admit(ip: string): Admission | null {
        if ((this.socketsPerIp.get(ip) ?? 0) >= this.limits.maxSocketsPerIp) {
            return { message: 'Too many sockets from this address', retryAfterMs: 60_000 };
        }
        const wait = this.connections.take(ip);
        return wait === 0 ? null : { message: 'Too many connections from this address', retryAfterMs: wait };
    }

    open(socket: PeerSocket, ip: string, name: string): Peer {
        const peer = new Peer(socket, ip, name, this.now());
        this.peers.add(peer);
        this.socketsPerIp.set(ip, (this.socketsPerIp.get(ip) ?? 0) + 1);
        return peer;
    }

    /* One frame from a peer; null for a frame that is not text. */
    message(peer: Peer, raw: string | null): void {
        if (peer.state === 'closed') {
            return;
        }
        peer.lastHeardAt = this.now();
        if (raw !== null && Buffer.byteLength(raw) > this.limits.maxMessageBytes) {
            this.close(peer, CLOSE.tooLarge, 'Frame too large');
            return;
        }
        // Counted before parsing, so a flood costs a map lookup and not a JSON parse per frame.
        const wait = this.frames.take(peer.ip);
        if (wait > 0) {
            this.send(peer, { type: 'rate-limited', scope: 'ip', retryAfterMs: wait });
            return;
        }
        let json: unknown = null;
        try {
            json = raw === null ? null : JSON.parse(raw);
        } catch {
            // Falls through to the schema, which refuses it.
        }
        const parsed = BrokerPeerFrameSchema.safeParse(json);
        if (!parsed.success) {
            this.refuseFrame(peer, 'That is not a broker frame');
            return;
        }
        const frame = parsed.data;
        switch (frame.type) {
            case 'hello': {
                if (peer.state !== 'new') {
                    this.refuseFrame(peer, 'A socket announces once');
                    return;
                }
                peer.role = frame.role;
                peer.publicKey = frame.publicKey;
                peer.nonce = randomBytes(24).toString('base64url');
                peer.state = 'challenged';
                this.send(peer, { type: 'challenge', broker: peer.name, nonce: peer.nonce });
                return;
            }
            case 'prove':
                this.prove(peer, frame.signature);
                return;
            case 'relay': {
                if (peer.state !== 'ready' || peer.publicKey === null) {
                    this.refuseFrame(peer, 'Announce before relaying');
                    return;
                }
                const waitRelay = this.relays.take(peer.publicKey);
                if (waitRelay > 0) {
                    this.send(peer, { type: 'rate-limited', scope: 'key', retryAfterMs: waitRelay, id: frame.id });
                    return;
                }
                const target = this.announced.get(frame.to);
                // A machine talks to clients and a client to machines; anything else is a key that is not there for this sender.
                if (!target || target.role === peer.role) {
                    this.send(peer, { type: 'error', code: 'not-connected', message: 'Nobody with that key is connected', id: frame.id });
                    return;
                }
                this.send(target, { type: 'relayed', from: peer.publicKey, envelope: frame.envelope, signature: frame.signature });
                this.send(peer, { type: 'delivered', id: frame.id });
                return;
            }
            case 'ice':
                void this.ice(peer, frame.id);
                return;
        }
    }

    /* A pong: the peer is still there. */
    heard(peer: Peer): void {
        peer.lastHeardAt = this.now();
    }

    /* The socket is gone, whoever closed it. */
    closed(peer: Peer): void {
        if (!this.peers.delete(peer)) {
            return;
        }
        peer.state = 'closed';
        if (peer.publicKey !== null && this.announced.get(peer.publicKey) === peer) {
            this.announced.delete(peer.publicKey);
        }
        const count = (this.socketsPerIp.get(peer.ip) ?? 1) - 1;
        if (count <= 0) {
            this.socketsPerIp.delete(peer.ip);
        } else {
            this.socketsPerIp.set(peer.ip, count);
        }
    }

    /*
     * Run every few seconds: a socket that never proved a key in time goes, a socket that has been
     * silent through two heartbeats goes, and everyone else is pinged once per heartbeat.
     */
    sweep(): void {
        const now = this.now();
        for (const peer of [...this.peers]) {
            if (peer.state !== 'ready' && now - peer.openedAt > this.limits.helloTimeoutMs) {
                this.close(peer, CLOSE.timeout, 'No signature in time');
                continue;
            }
            if (now - peer.lastHeardAt > this.limits.heartbeatMs * 2) {
                this.close(peer, CLOSE.timeout, 'No heartbeat');
                continue;
            }
            if (now - peer.lastPingAt >= this.limits.heartbeatMs) {
                peer.lastPingAt = now;
                peer.socket.ping();
            }
        }
        for (const limiter of [this.connections, this.frames, this.relays, this.announcements, this.iceRequests]) {
            limiter.prune();
        }
    }

    closeAll(): void {
        for (const peer of [...this.peers]) {
            this.close(peer, 1001, 'Broker going away');
        }
    }

    private prove(peer: Peer, signature: string): void {
        if (peer.state !== 'challenged' || peer.role === null || peer.publicKey === null || peer.nonce === null) {
            this.refuseFrame(peer, 'Nothing to prove yet');
            return;
        }
        const message = brokerHelloMessage(peer.name, peer.role, peer.publicKey, peer.nonce);
        // A nonce is good for one answer, right or wrong.
        peer.nonce = null;
        if (!verifySignature(peer.publicKey, message, signature)) {
            this.send(peer, { type: 'error', code: 'bad-signature', message: 'The signature does not verify for that key' });
            this.close(peer, CLOSE.badSignature, 'Bad signature');
            return;
        }
        // Counted only once the key is proven: anyone can say hello with a machine's key, and would drain its budget.
        const waitKey = this.announcements.take(peer.publicKey);
        if (waitKey > 0) {
            this.send(peer, { type: 'rate-limited', scope: 'key', retryAfterMs: waitKey });
            this.close(peer, CLOSE.rateLimited, 'Announcing too often');
            return;
        }
        const previous = this.announced.get(peer.publicKey);
        if (previous) {
            // The later socket proved the same key, so it is the one that is really there; the earlier one is a dead NAT mapping or a second window.
            this.send(previous, { type: 'error', code: 'replaced', message: 'The same key announced on another socket' });
            this.close(previous, CLOSE.replaced, 'Replaced');
        }
        this.announced.set(peer.publicKey, peer);
        peer.state = 'ready';
        this.send(peer, { type: 'ready' });
    }

    /*
     * TURN credentials for a key that proved itself, and only for one: they are what lets a stranger
     * send traffic through the relay, so a socket that never signed gets none, and a key that asks too
     * often waits like one that relays too often.
     */
    private async ice(peer: Peer, id: string): Promise<void> {
        if (peer.state !== 'ready' || peer.role === null || peer.publicKey === null) {
            this.refuseFrame(peer, 'Announce before asking for ICE servers');
            return;
        }
        const wait = this.iceRequests.take(peer.publicKey);
        if (wait > 0) {
            this.send(peer, { type: 'rate-limited', scope: 'key', retryAfterMs: wait, id });
            return;
        }
        try {
            const grant = await this.turn.iceServersFor({ role: peer.role, publicKey: peer.publicKey });
            if (peer.state === 'ready') {
                this.send(peer, { type: 'ice', id, servers: grant.servers, expiresAt: grant.expiresAt });
            }
        } catch (e) {
            this.log.warn(`Could not hand out ICE servers: ${e instanceof Error ? e.message : String(e)}`);
            if (peer.state === 'ready') {
                this.send(peer, { type: 'error', code: 'internal', message: 'The broker could not hand out ICE servers', id });
            }
        }
    }

    /* A frame that is wrong: said, and before `ready` the end of the socket, since a peer that cannot announce has nothing else to do here. */
    private refuseFrame(peer: Peer, message: string): void {
        this.send(peer, { type: 'error', code: 'bad-frame', message });
        if (peer.state !== 'ready') {
            this.close(peer, CLOSE.badFrame, 'Bad frame');
        }
    }

    private send(peer: Peer, frame: BrokerServerFrame): void {
        try {
            peer.socket.send(JSON.stringify(frame));
        } catch {
            // A socket that is already going away takes nothing; its close handler cleans up.
        }
    }

    private close(peer: Peer, code: number, reason: string): void {
        try {
            peer.socket.close(code, reason);
        } catch {
            // Already closed.
        }
        this.closed(peer);
    }
}
