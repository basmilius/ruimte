import i18next from 'i18next';
import {
    LanDoorMachineFrameSchema,
    lanDoorMessage,
    randomToken,
    signalMessage,
    type LanDoorClientFrame,
    type LanDoorMachineFrame,
    type SignalAccess
} from '@ruimte/pulsar';
import type { ClientKey } from '@/endpoint/client-key';
import type { SignalingOpener } from './signaling';

// 24 random bytes, comfortably above the 16 the door asks for.
const NONCE_BYTES = 24;

export interface LanSignalingOptions {
    /* The socket URL of one door address the machine reported (`lanDoorUrl`). */
    url: string;
    /* The machine's key this row pinned. The door has to sign the client's nonce with it before anything else happens. */
    machineKey: string;
    /* The machine's own id, when the row knows it; a door that names another is not this machine. */
    machineId: string | null;
    key(): Promise<ClientKey | null>;
    verify(publicKey: string, message: string, signature: string): Promise<boolean>;
    /* A statement for the offer, for a machine that does not know this client's key yet; asked per offer, as over the broker. */
    access?(key: ClientKey): Promise<SignalAccess>;
    createSocket?(url: string): WebSocket;
    nonce?(): string;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/*
 * The signals over the machine's door on the local network. The client opens with a nonce and says
 * nothing about itself until the door signed that nonce with the pinned key: a private address is
 * somebody else's on another network, and that somebody learns nothing of this client. From then on
 * the frames are the signed envelopes a broker relays, believed only when the pinned key signed them.
 */
export const lanSignaling =
    (options: LanSignalingOptions): SignalingOpener =>
    (connectionId, events) => {
        const nonce = options.nonce?.() ?? randomToken(NONCE_BYTES);
        let socket: WebSocket | null = null;
        let signer: ClientKey | null = null;
        let proving = false;
        let closed = false;

        const detach = (): void => {
            if (!socket) {
                return;
            }
            socket.onclose = null;
            socket.onmessage = null;
            socket.onopen = null;
            socket.close();
            socket = null;
        };

        const fail = (reason: string): void => {
            if (closed) {
                return;
            }
            closed = true;
            detach();
            events.fail(reason);
        };

        const write = (frame: LanDoorClientFrame): void => {
            socket?.send(JSON.stringify(frame));
        };

        const prove = async (frame: Extract<LanDoorMachineFrame, { type: 'door' }>): Promise<void> => {
            const sameMachine = frame.publicKey === options.machineKey && (options.machineId === null || frame.machineId === options.machineId);
            if (!sameMachine || !(await options.verify(options.machineKey, lanDoorMessage(nonce, frame.machineId, frame.publicKey), frame.signature))) {
                fail(i18next.t('machines:lan.notProven'));
                return;
            }
            const key = await options.key();
            if (closed) {
                return;
            }
            if (key === null) {
                fail(i18next.t('machines:lan.noKey'));
                return;
            }
            signer = key;
            events.ready();
        };

        const accept = async (frame: Extract<LanDoorMachineFrame, { type: 'signal' }>, clientKey: string): Promise<void> => {
            if (frame.envelope.connectionId !== connectionId) {
                return;
            }
            if (!(await options.verify(options.machineKey, signalMessage(options.machineKey, clientKey, frame.envelope), frame.signature))) {
                fail(i18next.t('machines:lan.unsignedSignal'));
                return;
            }
            if (!closed) {
                events.signal(frame.envelope.signal);
            }
        };

        const onFrame = (raw: string): void => {
            let json: unknown;
            try {
                json = JSON.parse(raw);
            } catch {
                return;
            }
            const parsed = LanDoorMachineFrameSchema.safeParse(json);
            if (!parsed.success) {
                return;
            }
            const frame = parsed.data;
            if (frame.type === 'error') {
                fail(i18next.t('machines:lan.refused', { reason: frame.message }));
                return;
            }
            if (frame.type === 'door') {
                // Only the first proof counts; a second one on the same socket proves nothing new.
                if (proving) {
                    return;
                }
                proving = true;
                void prove(frame).catch((e: unknown) => fail(i18next.t('machines:lan.failed', { reason: messageOf(e) })));
                return;
            }
            // A signal before the proof held is not from a machine this client believes yet.
            if (signer !== null) {
                void accept(frame, signer.publicKey);
            }
        };

        try {
            socket = options.createSocket?.(options.url) ?? new WebSocket(options.url);
        } catch (e) {
            fail(i18next.t('machines:lan.failed', { reason: messageOf(e) }));
            return { send: () => undefined, close: () => undefined };
        }
        socket.onopen = () => write({ type: 'hello', nonce });
        socket.onmessage = (message) => onFrame(String(message.data));
        socket.onclose = () => fail(i18next.t('machines:lan.unreachable'));
        socket.onerror = () => {};

        return {
            send: (signal) => {
                const key = signer;
                if (key === null || closed) {
                    return;
                }
                const outgoing =
                    signal.kind === 'offer' && options.access
                        ? options
                              .access(key)
                              .then((access) => ({ ...signal, access }))
                              .catch((e: unknown) => {
                                  fail(i18next.t('machines:broker.noVouch', { reason: messageOf(e) }));
                                  return null;
                              })
                        : Promise.resolve(signal);
                void outgoing
                    .then(async (ready) => {
                        if (ready === null || closed) {
                            return;
                        }
                        const envelope = { connectionId, signal: ready };
                        const signature = await key.sign(signalMessage(key.publicKey, options.machineKey, envelope));
                        if (!closed) {
                            write({ type: 'signal', from: key.publicKey, envelope, signature });
                        }
                    })
                    .catch((e: unknown) => fail(i18next.t('machines:lan.failed', { reason: messageOf(e) })));
            },
            close: () => {
                closed = true;
                detach();
            }
        };
    };
