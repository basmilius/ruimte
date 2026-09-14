import { BrokerPeer, brokerHostOf, signalMessage, type BrokerRelayed, type SignalEnvelope } from '@ruimte/pulsar';
import { verifySignature } from '../auth/keys.ts';
import type { Relay } from '../auth/relay.ts';

// The first retry after a lost broker, doubling up to the second; a broker that is down is not hammered.
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

// The broker pings every 25 seconds by default; three missed pings is a socket that only looks open.
const SILENCE_MS = 90_000;

// How long a connection id stays tied to the key that offered it; well past the attempt timeout in `DirectPeers`.
const OWNER_TTL_MS = 60_000;

export interface BrokerRelayOptions {
    url: string;
    /* The daemon's own key from `endpoint.json`, and a signer that never hands out the private half. */
    publicKey: string;
    sign(message: string): string;
    /* Whether a client key is one a person paired with this machine. */
    isPaired(publicKey: string): Promise<boolean>;
    /* The WebRTC answer code, which takes a signal and a way back and knows nothing of where either goes. */
    receive(envelope: SignalEnvelope, reply: (envelope: SignalEnvelope) => void): void;
    createSocket?(url: string): WebSocket;
    backoffMinMs?: number;
    backoffMaxMs?: number;
    silenceMs?: number;
    log?: Pick<Console, 'log' | 'warn'>;
}

/*
 * The daemon's socket to the broker, so a client that has no route to this machine's address can
 * still signal a direct connection. It announces the key from `endpoint.json`, keeps the socket up
 * with a backoff, and hands every signal that a paired client signed to `DirectPeers`, signing what
 * goes back. What a signal is allowed to do past that is decided on the channel by its own handshake.
 */
export class BrokerRelay implements Relay {
    private readonly options: BrokerRelayOptions;
    private readonly log: Pick<Console, 'log' | 'warn'>;
    private readonly owners = new Map<string, { publicKey: string; expiresAt: number }>();
    private socket: WebSocket | null = null;
    private peer: BrokerPeer | null = null;
    private attempts = 0;
    private nextDelayMs: number | null = null;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private silenceTimer: ReturnType<typeof setInterval> | null = null;
    private lastHeardAt = 0;
    private stopped = false;
    // Said once per outage rather than on every retry.
    private announcedFailure = false;
    private readonly readyListeners = new Set<() => void>();

    constructor(options: BrokerRelayOptions) {
        this.options = options;
        this.log = options.log ?? console;
    }

    get isReady(): boolean {
        return this.peer?.isReady === true;
    }

    /* The broker gives no address of its own; a client finds this machine by its key. */
    async publish(): Promise<string | null> {
        this.connect();
        return null;
    }

    async stop(): Promise<void> {
        this.stopped = true;
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
        this.drop();
    }

    /* Resolves once the broker took this machine's signature; for tests and the Docker bench. */
    whenReady(): Promise<void> {
        if (this.isReady) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            const listener = (): void => {
                this.readyListeners.delete(listener);
                resolve();
            };
            this.readyListeners.add(listener);
        });
    }

    private connect(): void {
        if (this.stopped || this.socket) {
            return;
        }
        let socket: WebSocket;
        try {
            socket = (this.options.createSocket ?? ((url) => new WebSocket(url)))(this.options.url);
        } catch (e) {
            this.lost(`The broker URL does not open: ${e instanceof Error ? e.message : String(e)}`);
            return;
        }
        this.socket = socket;
        const peer = new BrokerPeer({
            role: 'machine',
            publicKey: this.options.publicKey,
            host: brokerHostOf(this.options.url),
            sign: (message) => this.options.sign(message),
            send: (frame) => socket.send(frame),
            events: {
                ready: () => {
                    this.attempts = 0;
                    this.announcedFailure = false;
                    this.log.log(`Announced to the broker at ${this.options.url}`);
                    for (const listener of [...this.readyListeners]) {
                        listener();
                    }
                },
                relayed: (frame) => void this.relayed(frame),
                refused: (frame) => {
                    if (frame.id !== undefined) {
                        // A reply that did not reach its client; the client's own timeout says so on that side.
                        return;
                    }
                    if (frame.type === 'rate-limited') {
                        this.nextDelayMs = frame.retryAfterMs;
                        return;
                    }
                    if (frame.code === 'replaced') {
                        // Another process holds this key on the broker; fighting it would knock both off in turn.
                        this.nextDelayMs = this.options.backoffMaxMs ?? BACKOFF_MAX_MS;
                    }
                    this.lost(`The broker refused this machine: ${frame.message}`);
                },
                failed: (reason) => {
                    this.lost(reason);
                }
            }
        });
        this.peer = peer;
        this.lastHeardAt = Date.now();
        socket.onopen = () => peer.start();
        socket.onmessage = (message) => {
            this.lastHeardAt = Date.now();
            void peer.receive(String(message.data));
        };
        // Bun's client hears the broker's heartbeat as a ping event; a silent socket is a dead one.
        socket.addEventListener('ping', () => {
            this.lastHeardAt = Date.now();
        });
        socket.onclose = () => {
            if (this.socket === socket) {
                this.lost('The broker closed the connection');
            }
        };
        socket.onerror = () => undefined;
        const silenceMs = this.options.silenceMs ?? SILENCE_MS;
        this.silenceTimer = setInterval(
            () => {
                if (Date.now() - this.lastHeardAt > silenceMs) {
                    this.lost('The broker went silent');
                }
            },
            Math.max(10, Math.floor(silenceMs / 6))
        );
    }

    private lost(reason: string): void {
        if (!this.socket && !this.peer) {
            return;
        }
        this.drop();
        if (this.stopped) {
            return;
        }
        if (!this.announcedFailure) {
            this.announcedFailure = true;
            this.log.warn(`${reason}; reconnecting to ${this.options.url}`);
        }
        const min = this.options.backoffMinMs ?? BACKOFF_MIN_MS;
        const max = this.options.backoffMaxMs ?? BACKOFF_MAX_MS;
        const backoff = Math.min(min * 2 ** this.attempts, max);
        // A little jitter, so every machine a restarted broker drops does not come back in the same millisecond.
        const delay = Math.max(this.nextDelayMs ?? 0, Math.round(backoff * (0.8 + Math.random() * 0.4)));
        this.nextDelayMs = null;
        this.attempts += 1;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.connect();
        }, delay);
    }

    private drop(): void {
        if (this.silenceTimer) {
            clearInterval(this.silenceTimer);
            this.silenceTimer = null;
        }
        const socket = this.socket;
        this.socket = null;
        this.peer = null;
        if (socket) {
            socket.onclose = null;
            socket.onmessage = null;
            socket.close();
        }
    }

    /*
     * One signal from a client. A signature that does not verify is dropped without a word: answering
     * it would let anyone make this machine sign messages for keys of their choosing. A signature that
     * verifies from a key nobody paired gets one signed `not-paired` for an offer, so a revoked client
     * hears why at once instead of waiting out its timeout, and no peer connection is ever made for it.
     */
    private async relayed(frame: BrokerRelayed): Promise<void> {
        const { from, envelope, signature } = frame;
        if (!verifySignature(from, signalMessage(from, this.options.publicKey, envelope), signature)) {
            this.log.warn('Dropped a signal whose signature does not verify');
            return;
        }
        const reply = (answer: SignalEnvelope): void => {
            void this.peer?.relay(from, answer);
        };
        if (!(await this.options.isPaired(from))) {
            if (envelope.signal.kind === 'offer') {
                reply({ connectionId: envelope.connectionId, signal: { kind: 'close', reason: 'not-paired' } });
            }
            return;
        }
        const now = Date.now();
        for (const [connectionId, owner] of this.owners) {
            if (owner.expiresAt < now) {
                this.owners.delete(connectionId);
            }
        }
        // An attempt belongs to the key that offered it, so another paired client cannot close or feed it.
        const owner = this.owners.get(envelope.connectionId);
        if (owner && owner.publicKey !== from) {
            return;
        }
        if (!owner && envelope.signal.kind === 'offer') {
            this.owners.set(envelope.connectionId, { publicKey: from, expiresAt: now + OWNER_TTL_MS });
        }
        this.options.receive(envelope, reply);
    }
}
