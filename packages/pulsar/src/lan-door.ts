import { z } from 'zod';
import { MachineIdSchema, NonceSchema, PublicKeySchema, SignatureSchema } from './keys.ts';
import { SignalEnvelopeSchema } from './signaling.ts';

/*
 * The door a machine keeps open on its local network, so a client on the same network signals a direct
 * connection without the broker. One WebSocket per attempt at `LAN_DOOR_PATH`, JSON frames. The client
 * speaks first with a nonce of its own and sends nothing about itself until the machine signed that
 * nonce with the key the client pinned, so a stranger at a private address that is reused on another
 * network learns nothing of the client. From then on the frames carry the signed envelopes a broker
 * relays, and the channel they open runs its own handshake as it does over the broker.
 */
export const LAN_DOOR_PATH = '/signal';

// The client's opening, before it says who it is.
export const LanDoorHelloSchema = z.object({
    type: z.literal('hello'),
    nonce: NonceSchema
});
export type LanDoorHello = z.infer<typeof LanDoorHelloSchema>;

/*
 * A signal for the machine, signed by the client over `signalMessage(from, machineKey, envelope)` as a
 * relay over the broker is. Every signal on one socket comes from the same key: the first fixes it.
 */
export const LanDoorSignalSchema = z.object({
    type: z.literal('signal'),
    from: PublicKeySchema,
    envelope: SignalEnvelopeSchema,
    signature: SignatureSchema
});
export type LanDoorSignal = z.infer<typeof LanDoorSignalSchema>;

export const LanDoorClientFrameSchema = z.discriminatedUnion('type', [LanDoorHelloSchema, LanDoorSignalSchema]);
export type LanDoorClientFrame = z.infer<typeof LanDoorClientFrameSchema>;

// The machine's answer to `hello`: its id and key, and its signature over `lanDoorMessage(nonce, machineId, publicKey)`.
export const LanDoorProofSchema = z.object({
    type: z.literal('door'),
    machineId: MachineIdSchema,
    publicKey: PublicKeySchema,
    signature: SignatureSchema
});
export type LanDoorProof = z.infer<typeof LanDoorProofSchema>;

/*
 * A signal from the machine, signed over `signalMessage(machineKey, clientKey, envelope)`. A refusal is
 * one of these too: a `close` whose reason says why, as the broker route answers it.
 */
export const LanDoorAnswerSchema = z.object({
    type: z.literal('signal'),
    envelope: SignalEnvelopeSchema,
    signature: SignatureSchema
});
export type LanDoorAnswer = z.infer<typeof LanDoorAnswerSchema>;

export const LanDoorErrorCodeSchema = z.enum([
    // The frame did not parse, came out of order (a signal before `hello`) or named a second key.
    'bad-frame',
    // Too many attempts from this address; the socket closes after this.
    'rate-limited',
    'internal'
]);
export type LanDoorErrorCode = z.infer<typeof LanDoorErrorCodeSchema>;

export const LanDoorErrorSchema = z.object({
    type: z.literal('error'),
    code: LanDoorErrorCodeSchema,
    message: z.string().max(512)
});
export type LanDoorError = z.infer<typeof LanDoorErrorSchema>;

export const LanDoorMachineFrameSchema = z.discriminatedUnion('type', [LanDoorProofSchema, LanDoorAnswerSchema, LanDoorErrorSchema]);
export type LanDoorMachineFrame = z.infer<typeof LanDoorMachineFrameSchema>;

/* The socket URL of a door at one address the machine reported; an IPv6 address goes in brackets. */
export const lanDoorUrl = (address: string, port: number): string => `ws://${address.includes(':') ? `[${address}]` : address}:${port}${LAN_DOOR_PATH}`;
