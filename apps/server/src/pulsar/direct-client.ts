import {
    channelBinding,
    clientChannelMessage,
    daemonChannelMessage,
    DIRECT_CHANNEL_LABEL,
    DirectChallengeFrameSchema,
    DirectVerdictFrameSchema,
    type DirectProofFrame
} from '@ruimte/contracts';
import type { SignalEnvelope } from '@ruimte/pulsar';
import { randomBytes } from 'node:crypto';
import { RTCPeerConnection } from 'werift';
import { signMessage, verifySignature } from '../auth/keys.ts';
import { localSecretProof } from './channel-auth.ts';
import { AUTHENTICATED_FRAME_CHARS, directChannel, fromWerift, UNAUTHENTICATED_FRAME_CHARS, type DirectChannel } from './data-channel.ts';

export type DirectCredential =
    | { kind: 'key'; publicKey: string; privateKey: string; daemonId: string; daemonPublicKey: string }
    | { kind: 'secret'; secret: string; daemonId: string }
    // No proof at all: answers the challenge with a request, which is what a client that skips the handshake does.
    | { kind: 'none' };

export interface DirectClientOptions {
    stunServers: string[];
    /* Sends a signal towards the daemon; whatever it answers goes into `receiveSignal`. */
    signal(envelope: SignalEnvelope): void;
    credential: DirectCredential;
    timeoutMs?: number;
}

interface Pending {
    resolve(value: unknown): void;
    reject(reason: Error): void;
}

/*
 * The client side of a direct connection outside a browser, on werift: for the Docker bench, the
 * probe and the tests. The app uses the browser's own `RTCPeerConnection` (`WebRtcLink` in the
 * client), which speaks the same frames.
 */
export class DirectClient {
    readonly connectionId = randomBytes(12).toString('base64url');
    /* How long the channel took to open and to pass the handshake, once it has. */
    readonly timings = { channelOpenMs: 0, authenticatedMs: 0 };
    private readonly options: DirectClientOptions;
    private readonly peer: RTCPeerConnection;
    private readonly pending = new Map<string, Pending>();
    private readonly frameListeners = new Set<(frame: string) => void>();
    private channel: DirectChannel | null = null;
    private offerSdp: string | null = null;
    private answered: (sdp: string) => void = () => undefined;
    private nextId = 1;

    constructor(options: DirectClientOptions) {
        this.options = options;
        this.peer = new RTCPeerConnection({ iceServers: options.stunServers.map((urls) => ({ urls })) });
    }

    receiveSignal(envelope: SignalEnvelope): void {
        if (envelope.connectionId !== this.connectionId) {
            return;
        }
        if (envelope.signal.kind === 'answer') {
            this.answered(envelope.signal.sdp);
        }
        if (envelope.signal.kind === 'close') {
            this.close();
        }
    }

    /* Offers, waits for the channel and runs the handshake; rejects with what the daemon or ICE said. */
    async open(): Promise<{ ticket: string | null }> {
        const started = Date.now();
        const raw = this.peer.createDataChannel(DIRECT_CHANNEL_LABEL, { ordered: true });
        const channel = directChannel(fromWerift(raw));
        this.channel = channel;
        const answer = new Promise<string>((resolve) => {
            this.answered = resolve;
        });
        await this.peer.setLocalDescription(await this.peer.createOffer());
        await waitFor(() => this.peer.iceGatheringState === 'complete', 5_000).catch(() => undefined);
        this.offerSdp = this.peer.localDescription!.sdp;
        this.options.signal({ connectionId: this.connectionId, signal: { kind: 'offer', sdp: this.offerSdp } });

        const timeoutMs = this.options.timeoutMs ?? 30_000;
        const answerSdp = await withTimeout(answer, timeoutMs, 'The machine did not answer the offer');
        await this.peer.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        const binding = channelBinding(this.offerSdp, answerSdp);
        // Listening before the channel opens, since the daemon speaks first the moment it does.
        const handshake = this.handshake(channel, binding);
        handshake.catch(() => undefined);

        await withTimeout(
            waitFor(() => raw.readyState === 'open', timeoutMs),
            timeoutMs,
            'The channel did not open'
        );
        this.timings.channelOpenMs = Date.now() - started;
        const verdict = await withTimeout(handshake, timeoutMs, 'The handshake did not finish');
        this.timings.authenticatedMs = Date.now() - started;
        channel.receiveWith((frame) => this.receive(frame), AUTHENTICATED_FRAME_CHARS);
        return verdict;
    }

    get isOpen(): boolean {
        return this.channel?.isOpen === true;
    }

    send(frame: string): number {
        return this.channel?.send(frame) ?? 0;
    }

    onFrame(listener: (frame: string) => void): () => void {
        this.frameListeners.add(listener);
        return () => {
            this.frameListeners.delete(listener);
        };
    }

    onClose(listener: () => void): void {
        this.channel?.onClose(listener);
    }

    request<T>(type: string, payload: unknown): Promise<T> {
        const id = `d${this.nextId++}`;
        const reply = new Promise<T>((resolve, reject) => {
            this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
        });
        if (this.send(JSON.stringify({ id, type, payload })) === 0) {
            this.pending.delete(id);
            return Promise.reject(new Error('The channel is not open'));
        }
        return reply;
    }

    close(): void {
        this.channel?.close(1000, 'done');
        for (const entry of this.pending.values()) {
            entry.reject(new Error('disconnected'));
        }
        this.pending.clear();
        void this.peer.close().catch(() => undefined);
    }

    private handshake(channel: DirectChannel, binding: string): Promise<{ ticket: string | null }> {
        const { credential } = this.options;
        return new Promise((resolve, reject) => {
            channel.onClose(() => reject(new Error('The channel closed during the handshake')));
            channel.receiveWith((raw) => {
                const json = JSON.parse(raw) as unknown;
                const challenge = DirectChallengeFrameSchema.safeParse(json);
                if (challenge.success) {
                    const { daemon } = challenge.data;
                    if (credential.kind === 'none') {
                        channel.send(JSON.stringify({ id: 'unproven', type: 'endpoint.info', payload: {} }));
                        return;
                    }
                    if (credential.kind === 'key') {
                        const signedBy = daemon.publicKey === credential.daemonPublicKey && daemon.id === credential.daemonId;
                        if (
                            !signedBy ||
                            !verifySignature(credential.daemonPublicKey, daemonChannelMessage(daemon.id, challenge.data.challenge, binding), daemon.signature)
                        ) {
                            reject(new Error('The machine on the other end did not sign this channel with the key that was pinned'));
                            channel.close(1000, 'imposter');
                            return;
                        }
                    }
                    const proof: DirectProofFrame =
                        credential.kind === 'key'
                            ? {
                                  type: 'direct.key',
                                  challenge: challenge.data.challenge,
                                  publicKey: credential.publicKey,
                                  signature: signMessage(
                                      credential.privateKey,
                                      clientChannelMessage(credential.daemonId, challenge.data.challenge, credential.publicKey, binding)
                                  )
                              }
                            : {
                                  type: 'direct.secret',
                                  challenge: challenge.data.challenge,
                                  proof: localSecretProof(credential.secret, credential.daemonId, challenge.data.challenge, binding)
                              };
                    channel.send(JSON.stringify(proof));
                    return;
                }
                const verdict = DirectVerdictFrameSchema.safeParse(json);
                if (!verdict.success) {
                    reject(new Error(`The machine sent something other than a handshake: ${raw.slice(0, 120)}`));
                    return;
                }
                if (verdict.data.type === 'direct.refused') {
                    reject(new Error(verdict.data.reason));
                    return;
                }
                resolve({ ticket: verdict.data.ticket });
            }, UNAUTHENTICATED_FRAME_CHARS);
        });
    }

    private receive(raw: string): void {
        for (const listener of this.frameListeners) {
            listener(raw);
        }
        const frame = JSON.parse(raw) as { id?: string | null; ok?: boolean; result?: unknown; error?: { code: string; message: string } };
        if (typeof frame.id !== 'string' || frame.ok === undefined) {
            return;
        }
        const entry = this.pending.get(frame.id);
        if (!entry) {
            return;
        }
        this.pending.delete(frame.id);
        if (frame.ok) {
            entry.resolve(frame.result);
        } else {
            entry.reject(new Error(`${frame.error?.code}: ${frame.error?.message}`));
        }
    }
}

const waitFor = async (ready: () => boolean, timeoutMs: number): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!ready()) {
        if (Date.now() > deadline) {
            throw new Error('Timed out');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (e: unknown) => {
                clearTimeout(timer);
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        );
    });
