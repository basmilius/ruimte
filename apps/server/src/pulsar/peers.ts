import { channelBinding, DIRECT_CHANNEL_LABEL } from '@ruimte/contracts';
import type { IceServer, SignalEnvelope } from '@ruimte/pulsar';
import { RTCPeerConnection } from 'werift';
import type { ClientAccess } from '../dispatcher.ts';
import { directChannel, fromWerift, type DirectChannel } from './data-channel.ts';
import { errorText } from '../error-text.ts';

// Offer to open channel, handshake included; a peer that has not got that far by then is not coming.
export const ATTEMPT_TIMEOUT_MS = 30_000;

// ICE is gathered whole before the answer goes out; a STUN server that does not answer costs this much, not the attempt.
const GATHER_TIMEOUT_MS = 5_000;

// Attempts that have not opened their channel yet, over every caller together.
const MAX_OPEN_ATTEMPTS = 32;

export interface DirectPeersOptions {
    /* The STUN and TURN servers for one attempt, asked per offer because TURN credentials expire; empty gathers host candidates only. */
    iceServers(): IceServer[];
    // The UDP ports ICE binds, for a daemon behind a firewall or a container that publishes a range.
    portRange: [number, number] | null;
    // Addresses to announce as host candidates on top of the interfaces, such as the address a container is published on.
    hostAddresses: string[];
    /* The handshake on a channel that just opened; null refuses it. */
    authenticate(channel: DirectChannel, binding: string, remoteAddress: string | null): Promise<ClientAccess | null>;
    /* A channel that passed the handshake, for the connection opener. */
    open(channel: DirectChannel, access: ClientAccess): void;
    attemptTimeoutMs?: number;
    log?: Pick<Console, 'log' | 'warn'>;
    /* werift's peer connection unless a test says otherwise. */
    createPeer?(configuration: ConstructorParameters<typeof RTCPeerConnection>[0]): RTCPeerConnection;
}

interface Attempt {
    peer: RTCPeerConnection;
    timer: ReturnType<typeof setTimeout> | null;
    channel: DirectChannel | null;
}

/*
 * The daemon's end of every direct connection. It answers offers and nothing else: the client is the
 * side that knows it wants a channel, and the side a broker will route from. Where a signal came from
 * is none of its business; `receive` takes one and a function that sends the reply back the same way,
 * so the socket that carries them today and the broker that will tomorrow both fit.
 */
export class DirectPeers {
    private readonly options: DirectPeersOptions;
    private readonly attempts = new Map<string, Attempt>();
    private readonly log: Pick<Console, 'log' | 'warn'>;

    constructor(options: DirectPeersOptions) {
        this.options = options;
        this.log = options.log ?? console;
    }

    receive(envelope: SignalEnvelope, reply: (envelope: SignalEnvelope) => void): void {
        const { connectionId, signal } = envelope;
        switch (signal.kind) {
            case 'offer':
                void this.answer(connectionId, signal.sdp, reply);
                return;
            case 'candidate': {
                const attempt = this.attempts.get(connectionId);
                // An empty candidate only says the other side is done trickling; everything this side needs is already in.
                if (attempt && signal.candidate !== '') {
                    void attempt.peer
                        .addIceCandidate({ candidate: signal.candidate, sdpMid: signal.sdpMid ?? undefined, sdpMLineIndex: signal.sdpMLineIndex ?? undefined })
                        .catch(() => undefined);
                }
                return;
            }
            case 'close':
                this.end(connectionId, 'the client closed it');
                return;
            case 'answer':
                // This side never offers, so an answer belongs to nothing here.
                return;
        }
    }

    /* How many attempts and channels are alive; for tests and diagnostics. */
    get size(): number {
        return this.attempts.size;
    }

    closeAll(): void {
        for (const connectionId of [...this.attempts.keys()]) {
            this.end(connectionId, 'the daemon is shutting down');
        }
    }

    private async answer(connectionId: string, offerSdp: string, reply: (envelope: SignalEnvelope) => void): Promise<void> {
        if (this.attempts.has(connectionId)) {
            return;
        }
        const opening = [...this.attempts.values()].filter((attempt) => attempt.timer !== null).length;
        if (opening >= MAX_OPEN_ATTEMPTS) {
            reply({ connectionId, signal: { kind: 'close', reason: 'declined' } });
            return;
        }
        const peer = (this.options.createPeer ?? ((configuration) => new RTCPeerConnection(configuration)))({
            iceServers: this.options.iceServers(),
            icePortRange: this.options.portRange ?? undefined,
            iceAdditionalHostAddresses: this.options.hostAddresses.length > 0 ? this.options.hostAddresses : undefined
        });
        const attempt: Attempt = {
            peer,
            channel: null,
            timer: setTimeout(() => {
                reply({ connectionId, signal: { kind: 'close', reason: 'timeout' } });
                this.end(connectionId, `did not open in time (${Math.round((this.options.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS) / 1000)} s)`);
            }, this.options.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS)
        };
        this.attempts.set(connectionId, attempt);

        peer.connectionStateChange.subscribe((state) => {
            if (state === 'failed') {
                // werift fails a pair that had no answer to its consent checks for 30 seconds (RFC 7675), as well as one that never connected.
                this.end(
                    connectionId,
                    attempt.timer === null ? 'ICE failed: the client stopped answering consent checks' : 'ICE failed before the channel opened'
                );
            } else if (state === 'closed') {
                this.end(connectionId, 'the peer connection closed');
            }
        });

        let binding: string | null = null;
        peer.onDataChannel.subscribe((raw) => {
            if (attempt.channel !== null || raw.label !== DIRECT_CHANNEL_LABEL || binding === null) {
                raw.close();
                return;
            }
            const channel = directChannel(fromWerift(raw));
            attempt.channel = channel;
            channel.onClose(() => this.end(connectionId, 'the channel closed'));
            void this.admit(connectionId, attempt, channel, binding, raw);
        });

        try {
            await peer.setRemoteDescription({ type: 'offer', sdp: offerSdp });
            await peer.setLocalDescription(await peer.createAnswer());
            await gathered(peer);
            const answerSdp = peer.localDescription?.sdp;
            if (!answerSdp || this.attempts.get(connectionId) !== attempt) {
                this.end(connectionId, 'no answer to send');
                return;
            }
            binding = channelBinding(offerSdp, answerSdp);
            reply({ connectionId, signal: { kind: 'answer', sdp: answerSdp } });
        } catch (e) {
            this.log.warn('Answering a direct connection failed:', errorText(e));
            reply({ connectionId, signal: { kind: 'close', reason: 'failed' } });
            this.end(connectionId, 'answering failed');
        }
    }

    private async admit(connectionId: string, attempt: Attempt, channel: DirectChannel, binding: string, raw: { readyState: string }): Promise<void> {
        // werift hands the channel over a moment before it marks it open, and the challenge cannot go out before that.
        await until(() => raw.readyState === 'open' || this.attempts.get(connectionId) !== attempt);
        if (this.attempts.get(connectionId) !== attempt) {
            return;
        }
        const access = await this.options.authenticate(channel, binding, remoteAddressOf(attempt.peer));
        if (this.attempts.get(connectionId) !== attempt) {
            return;
        }
        if (access === null) {
            // The refusal closes the channel once it has left, and that close ends the attempt.
            return;
        }
        if (attempt.timer) {
            clearTimeout(attempt.timer);
            attempt.timer = null;
        }
        this.log.log(`Direct connection ${tagOf(connectionId)} opened (${access.reachability}, ${this.attempts.size} alive)`);
        this.options.open(channel, access);
    }

    private end(connectionId: string, reason: string): void {
        const attempt = this.attempts.get(connectionId);
        if (!attempt) {
            return;
        }
        this.attempts.delete(connectionId);
        this.log.log(`Direct connection ${tagOf(connectionId)} ended: ${reason} (${this.attempts.size} alive)`);
        if (attempt.timer) {
            clearTimeout(attempt.timer);
        }
        attempt.channel?.close(1000, 'Connection ended');
        void attempt.peer.close().catch(() => undefined);
    }
}

// Enough of the id to follow one connection through the log without printing the whole of it.
const tagOf = (connectionId: string): string => connectionId.slice(0, 8);

const until = async (ready: () => boolean): Promise<void> => {
    while (!ready()) {
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
};

const gathered = (peer: RTCPeerConnection): Promise<void> =>
    new Promise((resolve) => {
        if (peer.iceGatheringState === 'complete') {
            resolve();
            return;
        }
        const timer = setTimeout(() => {
            subscription.unSubscribe();
            resolve();
        }, GATHER_TIMEOUT_MS);
        const subscription = peer.iceGatheringStateChange.subscribe((state) => {
            if (state === 'complete') {
                clearTimeout(timer);
                subscription.unSubscribe();
                resolve();
            }
        });
    });

/* The address the nominated candidate pair talks to, which is all `reachability` goes on; never proof of anything. */
const remoteAddressOf = (peer: RTCPeerConnection): string | null => {
    try {
        return peer.iceTransports[0]?.connection.nominated?.remoteAddr[0] ?? null;
    } catch {
        return null;
    }
};
