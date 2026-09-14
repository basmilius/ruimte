import {
    BrokerPeer,
    brokerHostOf,
    signalMessage,
    type BrokerError,
    type BrokerRateLimited,
    type BrokerRelayed,
    type SignalAccess,
    type SignalEnvelope
} from '@ruimte/pulsar';
import type { ClientKey } from '@/endpoint/client-key';
import type { SignalingOpener } from './signaling';

interface Member {
    ready(): void;
    relayed(frame: BrokerRelayed): void;
    refused(frame: BrokerError | BrokerRateLimited): void;
    lost(reason: string): void;
}

interface Shared {
    socket: WebSocket;
    peer: BrokerPeer;
    members: Set<Member>;
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
                queueMicrotask(() => member.ready());
            }
        } else {
            queueMicrotask(() => member.lost(`The broker URL ${url} does not open`));
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
                ready: () => {
                    for (const member of [...members]) {
                        member.ready();
                    }
                },
                relayed: (frame) => {
                    for (const member of [...members]) {
                        member.relayed(frame);
                    }
                },
                refused: (frame) => {
                    if (frame.id !== undefined) {
                        for (const member of [...members]) {
                            member.refused(frame);
                        }
                        return;
                    }
                    // Without an id the refusal is about the socket, which is then no use to anybody on it.
                    lose(
                        frame.type === 'rate-limited'
                            ? `The broker at ${host} is limiting this client; trying again in ${secondsOf(frame.retryAfterMs)} seconds`
                            : `The broker at ${host} refused this client: ${frame.message}`
                    );
                },
                failed: (reason) => lose(reason)
            }
        });
        const shared: Shared = { socket, peer, members };
        this.open.set(id, shared);
        socket.onopen = () => peer.start();
        socket.onmessage = (message) => void peer.receive(String(message.data));
        socket.onclose = () => lose(`The broker at ${host} could not be reached`);
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
    /* The machine's key this row pinned at pairing: the one key a signal is believed from. */
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
                fail('A signal on the broker names the machine but is not signed by it');
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
                    fail('A direct connection over the broker signs in with a key, and this browser cannot make one');
                    return;
                }
                signer = key;
                membership = sockets.join(options.brokerUrl, key, {
                    ready: () => {
                        if (!closed) {
                            events.ready();
                        }
                    },
                    relayed: (frame) => void accept(frame, key.publicKey),
                    refused: (frame) => {
                        if (frame.id === undefined || !ids.has(frame.id)) {
                            return;
                        }
                        if (frame.type === 'rate-limited') {
                            fail(`The broker at ${host} is limiting this client; trying again in ${secondsOf(frame.retryAfterMs)} seconds`);
                            return;
                        }
                        fail(
                            frame.code === 'not-connected'
                                ? `The machine is not connected to the broker at ${host}. It needs to run with the broker switched on.`
                                : `The broker at ${host} refused the signal: ${frame.message}`
                        );
                    },
                    lost: (reason) => fail(reason)
                });
            })
            .catch((e: unknown) => fail(`Could not sign in to the broker: ${e instanceof Error ? e.message : String(e)}`));

        return {
            send: (signal) => {
                const outgoing =
                    signal.kind === 'offer' && options.access && signer
                        ? options
                              .access(signer)
                              .then((access) => ({ ...signal, access }))
                              .catch((e: unknown) => {
                                  fail(`Your account could not vouch for this client: ${e instanceof Error ? e.message : String(e)}`);
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
