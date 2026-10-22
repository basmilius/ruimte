import { withTimeout } from '@adecore/agents';
import { BrokerPeer, brokerHostOf, signalMessage, type IceServer, type PeerStatement, type SignalEnvelope } from '@ruimte/pulsar';
import { verifySignature } from '@ruimte/pulsar/verify-node';
import { weriftIceServers } from '../pulsar/broker-relay.ts';
import { DirectClient } from '../pulsar/direct-client.ts';
import type { PeerMachine } from './peer-machines.ts';
import { checkedReply } from './peer-reply.ts';

/* The key this machine is let in under, which it signs with and never hands out. */
export interface PeerSigner {
    publicKey(): Promise<string>;
    sign(message: string): Promise<string>;
}

/* Signals to one machine and back. Only what that machine's key signed for this one comes out of it. */
export interface SignalLine {
    send(envelope: SignalEnvelope): void;
    onSignal(listener: (envelope: SignalEnvelope) => void): void;
    /* The line refused a signal, such as the machine not being on the broker; its reason in words. */
    onRefused(listener: (reason: string) => void): void;
    iceServers: IceServer[];
    close(): void;
}

/* An open link to another machine: requests to it, and word when it is gone. */
export interface PeerLink {
    request<T>(type: string, payload: unknown): Promise<T>;
    /* Every frame that is not the reply to a request, as the machine wrote it. */
    onFrame(listener: (raw: string) => void): () => void;
    /* Once, when nothing answers any more or the channel closed. */
    onLost(listener: () => void): void;
    close(): void;
}

/* How long a broker may take to sign in, and a machine to answer the offer and finish the handshake. */
export const PEER_ATTEMPT_TIMEOUT_MS = 30_000;

export interface BrokerLineOptions {
    url: string;
    signer: PeerSigner;
    /* The machine whose signals are believed. */
    machinePublicKey: string;
    timeoutMs?: number;
    socket?: (url: string) => WebSocket;
}

/*
 * The broker as a line to one machine, signed in with the peer key in the client role. The broker only
 * carries the signals: the machine's signature on each is checked here, so a broker cannot put words in
 * its mouth.
 */
export async function openBrokerLine(options: BrokerLineOptions): Promise<SignalLine> {
    const timeoutMs = options.timeoutMs ?? PEER_ATTEMPT_TIMEOUT_MS;
    const publicKey = await options.signer.publicKey();
    const socket = options.socket?.(options.url) ?? new WebSocket(options.url);
    const listeners = new Set<(envelope: SignalEnvelope) => void>();
    const refusals = new Set<(reason: string) => void>();
    let iceId: string | null = null;
    let resolveReady: () => void = () => undefined;
    let resolveIce: (servers: IceServer[]) => void = () => undefined;
    let fail: (reason: Error) => void = () => undefined;
    const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        fail = reject;
    });
    const ice = new Promise<IceServer[]>((resolve) => {
        resolveIce = resolve;
    });
    const peer = new BrokerPeer({
        role: 'client',
        publicKey,
        host: brokerHostOf(options.url),
        sign: (message) => options.signer.sign(message),
        send: (frame) => socket.send(frame),
        events: {
            ready: () => resolveReady(),
            relayed: (frame) => {
                if (
                    frame.from !== options.machinePublicKey ||
                    !verifySignature(options.machinePublicKey, signalMessage(options.machinePublicKey, publicKey, frame.envelope), frame.signature)
                ) {
                    return;
                }
                for (const listener of listeners) {
                    listener(frame.envelope);
                }
            },
            ice: (frame) => {
                if (frame.id === iceId) {
                    resolveIce(frame.servers);
                }
            },
            refused: (frame) => {
                const reason =
                    frame.type === 'error' && frame.code === 'not-connected'
                        ? 'That machine is not online'
                        : `The broker refused: ${frame.type === 'error' ? frame.code : frame.type}`;
                // Before it signed this machine in, a refusal is the socket's; after, the offer's.
                fail(new Error(reason));
                resolveIce([]);
                for (const listener of refusals) {
                    listener(reason);
                }
            },
            failed: (reason) => fail(new Error(reason))
        }
    });
    socket.onopen = () => peer.start();
    socket.onmessage = (message) => void peer.receive(String(message.data));
    socket.onerror = () => fail(new Error('Could not connect through your account'));
    socket.onclose = () => fail(new Error('The connection through your account closed'));
    try {
        await withTimeout(ready, timeoutMs, 'The broker did not sign this machine in');
        iceId = peer.ice();
        const iceServers = await withTimeout(ice, timeoutMs, 'The broker did not name ICE servers').catch(() => []);
        return {
            send: (envelope) => void peer.relay(options.machinePublicKey, envelope),
            onSignal: (listener) => {
                listeners.add(listener);
            },
            onRefused: (listener) => {
                refusals.add(listener);
            },
            iceServers: weriftIceServers(iceServers),
            close: () => socket.close()
        };
    } catch (e) {
        socket.close();
        throw e;
    }
}

export interface PeerLinkOptions {
    line: SignalLine;
    signer: PeerSigner;
    machine: Pick<PeerMachine, 'machineId' | 'publicKey'>;
    /* What the machine calls this one in its list of who has access. */
    label: string;
    /* The statement of the address book that lets this key in the first time; absent once it is known there. */
    statement: PeerStatement | null;
    timeoutMs?: number;
    ping?: { idleMs?: number; timeoutMs?: number };
}

/* Opens a direct channel to the machine through `line` and proves the peer key over it; rejects with what the machine said. */
export async function openPeerLink(options: PeerLinkOptions): Promise<PeerLink> {
    const { line, machine } = options;
    const publicKey = await options.signer.publicKey();
    const client = new DirectClient({
        stunServers: [],
        iceServers: line.iceServers,
        credential: {
            kind: 'signer',
            publicKey,
            sign: (message) => options.signer.sign(message),
            daemonId: machine.machineId,
            daemonPublicKey: machine.publicKey
        },
        ...(options.statement === null ? {} : { access: { peer: options.statement, label: options.label } }),
        timeoutMs: options.timeoutMs ?? PEER_ATTEMPT_TIMEOUT_MS,
        ping: options.ping ?? {},
        signal: (envelope) => line.send(envelope)
    });
    line.onSignal((envelope) => client.receiveSignal(envelope));
    const refused = new Promise<never>((_, reject) => line.onRefused((reason) => reject(new Error(reason))));
    // A refusal that comes after the channel opened has nobody waiting for it.
    refused.catch(() => undefined);
    try {
        await Promise.race([client.open(), refused]);
    } catch (e) {
        client.close();
        throw e;
    }
    // The channel carries everything from here, so the line has nothing left to do.
    line.close();
    return {
        request: async <T>(type: string, payload: unknown): Promise<T> => checkedReply<T>(type, await client.request(type, payload)),
        onFrame: (listener) => client.onFrame(listener),
        onLost: (listener) => {
            client.onLost(listener);
            client.onClose(listener);
        },
        close: () => client.close()
    };
}
