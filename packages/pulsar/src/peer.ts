import { BrokerServerFrameSchema, type BrokerError, type BrokerRateLimited, type BrokerRelayed, type BrokerRole, type BrokerPeerFrame } from './broker.ts';
import type { SignalEnvelope } from './signaling.ts';
import { brokerHelloMessage, signalMessage } from './signing.ts';

export interface BrokerPeerEvents {
    /* The broker took the signature; relays go out from here. */
    ready(): void;
    /* A signal for this key. The broker only says who sent it: checking the signature is the receiver's job. */
    relayed(frame: BrokerRelayed): void;
    /* The broker refused something: a relay (the frame carries its id) or the socket itself. */
    refused(frame: BrokerError | BrokerRateLimited): void;
    /* The broker wrote a relay to the receiver's socket. */
    delivered?(id: string): void;
    /* Something that makes this socket worthless, such as a challenge for a host this peer did not dial. */
    failed(reason: string): void;
}

export interface BrokerPeerOptions {
    role: BrokerRole;
    publicKey: string;
    /* The host this peer dialed, as `brokerHostOf` reads it off the URL. */
    host: string;
    sign(message: string): string | Promise<string>;
    send(frame: string): void;
    events: BrokerPeerEvents;
}

/* `host[:port]` of a broker URL, which is what a broker names in its challenge. */
export const brokerHostOf = (url: string): string => new URL(url).host;

/*
 * One peer's side of a broker socket, without the socket: the daemon, the client and the tests all
 * wrap their own WebSocket around it. It announces the key, answers the challenge, and signs every
 * relay end to end, so no caller can forget the one step that keeps the broker out of the DTLS
 * handshake.
 */
export class BrokerPeer {
    private readonly options: BrokerPeerOptions;
    private state: 'idle' | 'announced' | 'ready' | 'failed' = 'idle';
    private nextId = 1;

    constructor(options: BrokerPeerOptions) {
        this.options = options;
    }

    get isReady(): boolean {
        return this.state === 'ready';
    }

    /* Call once the socket is open. */
    start(): void {
        if (this.state !== 'idle') {
            return;
        }
        this.state = 'announced';
        this.write({ type: 'hello', role: this.options.role, publicKey: this.options.publicKey });
    }

    async receive(raw: string): Promise<void> {
        if (this.state === 'failed') {
            return;
        }
        let json: unknown;
        try {
            json = JSON.parse(raw);
        } catch {
            this.fail('The broker sent something that is not JSON');
            return;
        }
        const parsed = BrokerServerFrameSchema.safeParse(json);
        if (!parsed.success) {
            this.fail('The broker sent a frame this peer cannot read');
            return;
        }
        const frame = parsed.data;
        switch (frame.type) {
            case 'challenge': {
                if (this.state !== 'announced') {
                    return;
                }
                // A nonce from a broker on another host is one a man in the middle could be passing along.
                if (frame.broker !== this.options.host) {
                    this.fail(`The broker at ${this.options.host} calls itself ${frame.broker}`);
                    return;
                }
                const signature = await this.options.sign(brokerHelloMessage(frame.broker, this.options.role, this.options.publicKey, frame.nonce));
                this.write({ type: 'prove', signature });
                return;
            }
            case 'ready':
                if (this.state === 'announced') {
                    this.state = 'ready';
                    this.options.events.ready();
                }
                return;
            case 'relayed':
                if (this.state === 'ready') {
                    this.options.events.relayed(frame);
                }
                return;
            case 'delivered':
                this.options.events.delivered?.(frame.id);
                return;
            case 'error':
            case 'rate-limited':
                this.options.events.refused(frame);
                return;
        }
    }

    /* Signs and sends one signal for another key; answers the frame id a refusal will name, or null before `ready`. */
    async relay(to: string, envelope: SignalEnvelope): Promise<string | null> {
        if (this.state !== 'ready') {
            return null;
        }
        const id = `relay-${this.nextId++}`;
        const signature = await this.options.sign(signalMessage(this.options.publicKey, to, envelope));
        this.write({ type: 'relay', id, to, envelope, signature });
        return id;
    }

    private write(frame: BrokerPeerFrame): void {
        this.options.send(JSON.stringify(frame));
    }

    private fail(reason: string): void {
        this.state = 'failed';
        this.options.events.failed(reason);
    }
}
