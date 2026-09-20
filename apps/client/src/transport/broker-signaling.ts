import i18next from 'i18next';
import {
    BrokerPeer,
    brokerHostOf,
    signalMessage,
    type BrokerError,
    type IceServer,
    type BrokerRateLimited,
    type BrokerRelayed,
    type SignalAccess,
    type SignalEnvelope
} from '@ruimte/pulsar';
import type { ClientKey } from '@/endpoint/client-key';
import type { SignalingOpener } from './signaling';

interface Member {
    ready(iceServers: IceServer[]): void;
    relayed(frame: BrokerRelayed): void;
    refused(frame: BrokerError | BrokerRateLimited): void;
    lost(reason: string): void;
}

interface Shared {
    socket: WebSocket;
    peer: BrokerPeer;
    members: Set<Member>;
    /* What the broker handed out for this key, once it answered `ice`; null while the question is out. */
    ice: { servers: IceServer[]; expiresAt: number | null } | null;
    iceRequestId: string | null;
}

export interface BrokerMembership {
    relay(to: string, envelope: SignalEnvelope): Promise<string | null>;
    leave(): void;
}

const secondsOf = (ms: number): number => Math.max(1, Math.ceil(ms / 1000));

/*
 * One socket per broker for every attempt this page makes at once. The broker lets a key hold one
 * socket and replaces the older one when it announces again, and this client signs in with one key
 * for every machine, so two machines coming up together would otherwise knock each other off. The
 * socket closes when the last attempt leaves it, which is the moment its channel is in.
 */
export class BrokerSockets {
    private readonly open = new Map<string, Shared>();
    private readonly createSocket: (url: string) => WebSocket;

    constructor(createSocket: (url: string) => WebSocket = (url) => new WebSocket(url)) {
        this.createSocket = createSocket;
    }

    join(url: string, key: ClientKey, member: Member): BrokerMembership {
        const id = `${url} ${key.publicKey}`;
        let shared = this.open.get(id) ?? null;
        if (!shared) {
            shared = this.connect(id, url, key);
        }
        const joined = shared;
        if (joined) {
            joined.members.add(member);
            if (joined.peer.isReady) {
                if (joined.ice !== null && (joined.ice.expiresAt === null || joined.ice.expiresAt > Date.now())) {
                    const servers = joined.ice.servers;
                    queueMicrotask(() => member.ready(servers));
                } else if (joined.iceRequestId === null) {
                    // Credentials that lapsed while the socket stayed open are asked for again; the member waits for the answer.
                    joined.iceRequestId = joined.peer.ice();
                }
            }
        } else {
            queueMicrotask(() => member.lost(i18next.t('machines:broker.badUrl', { url })));
        }
        return {
            relay: (to, envelope) => joined?.peer.relay(to, envelope) ?? Promise.resolve(null),
            leave: () => {
                if (!joined || !joined.members.delete(member) || joined.members.size > 0) {
                    return;
                }
                this.drop(id, joined);
            }
        };
    }

    private connect(id: string, url: string, key: ClientKey): Shared | null {
        const host = brokerHostOf(url);
        let socket: WebSocket;
        try {
            socket = this.createSocket(url);
        } catch {
            return null;
        }
        const members = new Set<Member>();
        const settleIce = (servers: IceServer[], expiresAt: number | null): void => {
            shared.ice = { servers, expiresAt };
            shared.iceRequestId = null;
            for (const member of [...members]) {
                member.ready(servers);
            }
        };
        const lose = (reason: string): void => {
            if (this.open.get(id) !== shared) {
                return;
            }
            this.drop(id, shared);
            for (const member of [...members]) {
                member.lost(reason);
            }
        };
        const peer = new BrokerPeer({
            role: 'client',
            publicKey: key.publicKey,
            host,
            sign: (message) => key.sign(message),
            send: (frame) => socket.send(frame),
            events: {
                // Signals wait for the ICE servers, since the offer is gathered with them.
                ready: () => {
                    shared.iceRequestId = peer.ice();
                },
                ice: (frame) => {
                    if (frame.id === shared.iceRequestId) {
                        settleIce(frame.servers, frame.expiresAt);
                    }
                },
                relayed: (frame) => {
                    for (const member of [...members]) {
                        member.relayed(frame);
                    }
                },
                refused: (frame) => {
                    if (frame.id !== undefined && frame.id === shared.iceRequestId) {
                        // A broker that could not hand out servers still signals; the attempt goes on with STUN alone.
                        settleIce([], null);
                        return;
                    }
                    if (frame.type === 'error' && frame.code === 'bad-frame' && frame.id === undefined && shared.iceRequestId !== null) {
                        // A broker from before `ice` refuses the frame without its id and keeps the socket.
                        settleIce([], null);
                        return;
                    }
                    if (frame.id !== undefined) {
                        for (const member of [...members]) {
                            member.refused(frame);
                        }
                        return;
                    }
                    // Without an id the refusal is about the socket, which is then no use to anybody on it.
                    lose(
                        frame.type === 'rate-limited'
                            ? i18next.t('machines:broker.limited', { host, seconds: secondsOf(frame.retryAfterMs) })
                            : i18next.t('machines:broker.refusedClient', { host, reason: frame.message })
                    );
                },
                failed: (reason) => lose(reason)
            }
        });
        const shared: Shared = { socket, peer, members, ice: null, iceRequestId: null };
        this.open.set(id, shared);
        socket.onopen = () => peer.start();
        socket.onmessage = (message) => void peer.receive(String(message.data));
        socket.onclose = () => lose(i18next.t('machines:broker.unreachable', { host }));
        socket.onerror = () => {};
        return shared;
    }

    private drop(id: string, shared: Shared): void {
        if (this.open.get(id) === shared) {
            this.open.delete(id);
        }
        shared.socket.onclose = null;
        shared.socket.onmessage = null;
        shared.socket.onopen = null;
        shared.socket.close();
    }
}

export const brokerSockets = new BrokerSockets();

export interface BrokerSignalingOptions {
    brokerUrl: string;
    /* The machine's key this row pinned at pairing. A signal is believed only from this key. */
    machineKey: string;
    key(): Promise<ClientKey | null>;
    verify(publicKey: string, message: string, signature: string): Promise<boolean>;
    /* A statement for the offer, for a machine that does not know this client's key yet; asked per offer, since the machine spends each one. */
    access?(key: ClientKey): Promise<SignalAccess>;
    sockets?: BrokerSockets;
}

/*
 * The signals over the broker, for a machine this client cannot reach at its own address. The client
 * announces its own key, signs the offer for the machine's key, and believes an answer only when the
 * machine's pinned key signed it for this client, so a broker that swaps a fingerprint is caught
 * here as well as in the channel's handshake.
 */
export const brokerSignaling =
    (options: BrokerSignalingOptions): SignalingOpener =>
    (connectionId, events) => {
        const sockets = options.sockets ?? brokerSockets;
        const host = brokerHostOf(options.brokerUrl);
        const ids = new Set<string>();
        let membership: BrokerMembership | null = null;
        let signer: ClientKey | null = null;
        let closed = false;

        const fail = (reason: string): void => {
            if (closed) {
                return;
            }
            closed = true;
            membership?.leave();
            membership = null;
            events.fail(reason);
        };

        const accept = async (frame: BrokerRelayed, clientKey: string): Promise<void> => {
            if (frame.from !== options.machineKey || frame.envelope.connectionId !== connectionId) {
                return;
            }
            if (!(await options.verify(options.machineKey, signalMessage(options.machineKey, clientKey, frame.envelope), frame.signature))) {
                fail(i18next.t('machines:direct.unsignedSignal'));
                return;
            }
            if (!closed) {
                events.signal(frame.envelope.signal);
            }
        };

        void options
            .key()
            .then((key) => {
                if (closed) {
                    return;
                }
                if (key === null) {
                    fail(i18next.t('machines:direct.noKeyOverBroker'));
                    return;
                }
                signer = key;
                membership = sockets.join(options.brokerUrl, key, {
                    ready: (iceServers) => {
                        if (!closed) {
                            events.ready(iceServers);
                        }
                    },
                    relayed: (frame) => void accept(frame, key.publicKey),
                    refused: (frame) => {
                        if (frame.id === undefined || !ids.has(frame.id)) {
                            return;
                        }
                        if (frame.type === 'rate-limited') {
                            fail(i18next.t('machines:broker.limited', { host, seconds: secondsOf(frame.retryAfterMs) }));
                            return;
                        }
                        fail(
                            frame.code === 'not-connected'
                                ? i18next.t('machines:broker.machineAbsent', { host })
                                : i18next.t('machines:broker.refusedSignal', { host, reason: frame.message })
                        );
                    },
                    lost: (reason) => fail(reason)
                });
            })
            .catch((e: unknown) => fail(i18next.t('machines:broker.signInFailed', { reason: e instanceof Error ? e.message : String(e) })));

        return {
            send: (signal) => {
                const outgoing =
                    signal.kind === 'offer' && options.access && signer
                        ? options
                              .access(signer)
                              .then((access) => ({ ...signal, access }))
                              .catch((e: unknown) => {
                                  fail(i18next.t('machines:broker.noVouch', { reason: e instanceof Error ? e.message : String(e) }));
                                  return null;
                              })
                        : Promise.resolve(signal);
                void outgoing.then((ready) => {
                    if (ready === null || closed) {
                        return;
                    }
                    void membership?.relay(options.machineKey, { connectionId, signal: ready }).then((id) => {
                        if (id !== null) {
                            ids.add(id);
                        }
                    });
                });
            },
            close: () => {
                closed = true;
                membership?.leave();
                membership = null;
            }
        };
    };
