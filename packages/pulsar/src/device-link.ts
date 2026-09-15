import { z } from 'zod';
import { AccountSchema, BrokerUrlSchema, MachineIconSchema, MachineSchema, TokenSchema } from './address-book.ts';
import { MachineIdSchema, PublicKeySchema, SignatureSchema } from './keys.ts';

/*
 * Linking a machine with a code: `ruimte login` on a machine without the app asks the address book for
 * a pending link, a person approves its code on the web client while signed in, and the machine then
 * signs an ordinary registration for the account that approved it. The machine never holds a session:
 * all it gets back is which account said yes.
 */

// Where a person approves a code; the address book hands this out, so it can move without a new daemon.
export const DEVICE_LINK_PAGE_URL = 'https://station.ruimte.app/link';

// How long a code waits for a person, counted from the start.
export const DEVICE_LINK_LIFETIME_MS = 10 * 60_000;

// What an approval leaves the terminal at the least to finish, however close to the end of the code it came.
export const DEVICE_LINK_COMPLETE_GRACE_MS = 2 * 60_000;

// Seconds between two polls; a terminal waiting on a person needs no more than this.
export const DEVICE_LINK_POLL_INTERVAL_S = 5;

/*
 * Consonants only, as RFC 8628 suggests: no vowels means no words, and no digits means no 0 and O or
 * 1 and I to confuse. Eight of twenty is 2.5e10 codes, against a lookup that is rate limited per
 * account and needs a signed-in session in the first place.
 */
export const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const USER_CODE_LENGTH = 8;

// Eight letters from the alphabet without a separator, the form the address book stores.
export const UserCodeSchema = z.string().regex(new RegExp(`^[${USER_CODE_ALPHABET}]{${USER_CODE_LENGTH}}$`), 'Expected a code of eight letters');

/* A fresh code. Bytes of 240 and over are drawn again, since 256 is no multiple of 20 and would favor the first letters. */
export const generateUserCode = (random: (count: number) => Uint8Array = (count) => crypto.getRandomValues(new Uint8Array(count))): string => {
    let code = '';
    while (code.length < USER_CODE_LENGTH) {
        for (const byte of random(USER_CODE_LENGTH * 2)) {
            if (byte < 240 && code.length < USER_CODE_LENGTH) {
                code += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
            }
        }
    }
    return code;
};

// `BCDFGHJK` as `BCDF-GHJK`, which is how a terminal prints it and a person reads it out.
export const formatUserCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

/* What a person typed, as the stored form, or null when it cannot be a code: case, spaces and dashes do not matter. */
export const normalizeUserCode = (input: string): string | null => {
    const code = input.toUpperCase().replace(/[\s-]/g, '');
    return UserCodeSchema.safeParse(code).success ? code : null;
};

/*
 * The first eight bytes of a public key in hex, in four groups: short enough to compare between a
 * terminal and a page, and 64 bits is more than anyone can grind a look-alike key for.
 */
export const keyFingerprint = (publicKey: string): string => {
    const binary = atob(publicKey.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (publicKey.length % 4)) % 4));
    let hex = '';
    for (let i = 0; i < Math.min(8, binary.length); i++) {
        hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return hex.match(/.{1,4}/g)?.join(' ') ?? '';
};

const DeviceLinkMachineNameSchema = z.string().min(1).max(80);

/*
 * `POST /v1/device/start`, without a session. The signature over `deviceLinkStartMessage` proves the
 * machine holds the key the approval page shows; it names no account, since none is known yet, which
 * is why nothing lands on an account before the machine signs a registration for one.
 */
export const DeviceLinkStartPayloadSchema = z.object({
    id: MachineIdSchema,
    name: DeviceLinkMachineNameSchema,
    icon: MachineIconSchema.nullable(),
    brokerUrl: BrokerUrlSchema.nullable(),
    publicKey: PublicKeySchema,
    issuedAt: z.number().int().min(0),
    signature: SignatureSchema
});
export type DeviceLinkStartPayload = z.infer<typeof DeviceLinkStartPayloadSchema>;

export const DeviceLinkStartResultSchema = z.object({
    // Only the terminal holds it: it polls, finishes and cancels with it.
    deviceCode: TokenSchema,
    // Formatted, `BCDF-GHJK`.
    userCode: z.string().min(1).max(16),
    verificationUri: z.url(),
    // The page with the code filled in, for a link or a QR code.
    verificationUriComplete: z.url(),
    expiresAt: z.number().int(),
    interval: z.number().int().min(1)
});
export type DeviceLinkStartResult = z.infer<typeof DeviceLinkStartResultSchema>;

// `POST /v1/device/poll` and `POST /v1/device/cancel`.
export const DeviceCodePayloadSchema = z.object({ deviceCode: TokenSchema });
export type DeviceCodePayload = z.infer<typeof DeviceCodePayloadSchema>;

export const DeviceLinkStatusSchema = z.enum(['pending', 'approved', 'denied', 'expired', 'cancelled']);
export type DeviceLinkStatus = z.infer<typeof DeviceLinkStatusSchema>;

export const DeviceLinkPollResultSchema = z.object({
    status: DeviceLinkStatusSchema,
    interval: z.number().int().min(1),
    // The account that approved, once one did: the id the machine signs its registration for.
    account: AccountSchema.nullable()
});
export type DeviceLinkPollResult = z.infer<typeof DeviceLinkPollResultSchema>;

/*
 * `POST /v1/device/complete`: the machine's signature over `machineRegistrationMessage` for the
 * account that approved, the same bytes `endpoint.signRegistration` makes. The name, the icon and the
 * broker are the ones the start carried. The device code is spent by it.
 */
export const DeviceLinkCompletePayloadSchema = z.object({
    deviceCode: TokenSchema,
    issuedAt: z.number().int().min(0),
    signature: SignatureSchema
});
export type DeviceLinkCompletePayload = z.infer<typeof DeviceLinkCompletePayloadSchema>;

export const DeviceLinkCompleteResultSchema = z.object({
    machine: MachineSchema,
    account: AccountSchema
});
export type DeviceLinkCompleteResult = z.infer<typeof DeviceLinkCompleteResultSchema>;

// `POST /v1/device/lookup`, `/approve` and `/deny`, with a session. The code as a person typed it.
export const UserCodePayloadSchema = z.object({ userCode: z.string().min(1).max(32) });
export type UserCodePayload = z.infer<typeof UserCodePayloadSchema>;

// What the approval page shows before a person says yes.
export const DeviceLinkMachineSchema = z.object({
    id: MachineIdSchema,
    name: DeviceLinkMachineNameSchema,
    icon: MachineIconSchema.nullable(),
    publicKey: PublicKeySchema
});
export type DeviceLinkMachine = z.infer<typeof DeviceLinkMachineSchema>;

export const DeviceLinkLookupResultSchema = z.object({
    machine: DeviceLinkMachineSchema,
    expiresAt: z.number().int()
});
export type DeviceLinkLookupResult = z.infer<typeof DeviceLinkLookupResultSchema>;
