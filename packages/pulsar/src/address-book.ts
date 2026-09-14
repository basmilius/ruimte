import { z } from 'zod';
import { MachineIdSchema, NonceSchema, PublicKeySchema, SignatureSchema } from './keys.ts';

/*
 * The address book's HTTP API, as JSON bodies. It knows which machines belong to an account and
 * signs access statements; a daemon believes one because the address book's public key is pinned
 * in the build.
 */

// How long a statement is good for, counted from `issuedAt`.
export const ACCESS_STATEMENT_LIFETIME_MS = 120_000;

const MachineNameSchema = z.string().min(1).max(80);

export const MachineSchema = z.object({
    id: MachineIdSchema,
    name: MachineNameSchema,
    publicKey: PublicKeySchema,
    // Milliseconds since the epoch; null for a machine that registered and never came online since.
    lastSeenAt: z.number().int().nullable()
});
export type Machine = z.infer<typeof MachineSchema>;

// `GET /machines`
export const MachineListResultSchema = z.object({
    machines: z.array(MachineSchema)
});
export type MachineListResult = z.infer<typeof MachineListResultSchema>;

/*
 * `POST /machines`, sent by the client that sits on the machine, with the daemon's signature over
 * `machineRegistrationMessage`. The client cannot sign for the daemon's key, so a machine lands in
 * an account only when the daemon itself agreed to that account.
 */
export const RegisterMachinePayloadSchema = z.object({
    id: MachineIdSchema,
    name: MachineNameSchema,
    publicKey: PublicKeySchema,
    issuedAt: z.number().int().min(0),
    signature: SignatureSchema
});
export type RegisterMachinePayload = z.infer<typeof RegisterMachinePayloadSchema>;

export const RegisterMachineResultSchema = z.object({
    machine: MachineSchema
});
export type RegisterMachineResult = z.infer<typeof RegisterMachineResultSchema>;

/*
 * `POST /statements`: a signed-in client asking for a statement to show one machine. The nonce is
 * the machine's, handed out over the channel, so a statement is good at that machine for that one
 * connection; the signature over `accessRequestMessage` proves the client holds the key it names.
 */
export const AccessRequestPayloadSchema = z.object({
    machineId: MachineIdSchema,
    clientPublicKey: PublicKeySchema,
    nonce: NonceSchema,
    signature: SignatureSchema
});
export type AccessRequestPayload = z.infer<typeof AccessRequestPayloadSchema>;

// The address book's signature is over `accessStatementMessage`.
export const AccessStatementSchema = z
    .object({
        machineId: MachineIdSchema,
        clientPublicKey: PublicKeySchema,
        nonce: NonceSchema,
        issuedAt: z.number().int().min(0),
        expiresAt: z.number().int().min(0),
        signature: SignatureSchema
    })
    .refine((statement) => statement.expiresAt > statement.issuedAt && statement.expiresAt - statement.issuedAt <= ACCESS_STATEMENT_LIFETIME_MS, {
        message: `A statement is valid for at most ${ACCESS_STATEMENT_LIFETIME_MS} ms`,
        path: ['expiresAt']
    });
export type AccessStatement = z.infer<typeof AccessStatementSchema>;

export const AddressBookErrorCodeSchema = z.enum(['bad-request', 'unauthorized', 'bad-signature', 'not-found', 'rate-limited', 'internal']);
export type AddressBookErrorCode = z.infer<typeof AddressBookErrorCodeSchema>;

export const AddressBookErrorSchema = z.object({
    error: z.object({
        code: AddressBookErrorCodeSchema,
        message: z.string().max(512)
    })
});
export type AddressBookError = z.infer<typeof AddressBookErrorSchema>;
