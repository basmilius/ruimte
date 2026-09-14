import { z } from 'zod';
import { MachineIdSchema, NonceSchema, PublicKeySchema, SignatureSchema } from './keys.ts';

/*
 * The address book's HTTP API, as JSON bodies. It knows which machines belong to an account and
 * signs access statements; a daemon believes one because the address book's public key is pinned
 * in the build (`statement-key.ts`).
 */

export const ADDRESS_BOOK_URL = 'https://pulsar.ruimte.app';

// How long a statement is good for, counted from `issuedAt`.
export const ACCESS_STATEMENT_LIFETIME_MS = 120_000;

// How far a registration's `issuedAt` may lie from the address book's clock, either way.
export const MACHINE_REGISTRATION_MAX_SKEW_MS = 600_000;

// Apple and Google are next; an account row already names its provider.
export const ProviderIdSchema = z.enum(['github']);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

// 32 random bytes in base64url: access and refresh tokens, and the one-time login code.
export const TokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Expected a token');

/*
 * Where the address book sends the browser back after a login: a custom scheme for an app that can
 * register one, or a loopback listener on any port for one that cannot (RFC 8252, 7.1 and 7.3).
 * Nothing else, so a login started from a page elsewhere cannot hand its code to that page.
 */
export const APP_REDIRECT_SCHEME_URI = 'ruimte://pulsar/callback';
export const APP_REDIRECT_LOOPBACK_PATH = '/pulsar/callback';

export const isAppRedirectUri = (value: string): boolean => {
    if (value === APP_REDIRECT_SCHEME_URI) {
        return true;
    }
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    return (
        url.protocol === 'http:' &&
        (url.hostname === '127.0.0.1' || url.hostname === '[::1]') &&
        url.port !== '' &&
        url.pathname === APP_REDIRECT_LOOPBACK_PATH &&
        url.search === '' &&
        url.hash === '' &&
        url.username === '' &&
        url.password === '' &&
        value === `http://${url.host}${APP_REDIRECT_LOOPBACK_PATH}`
    );
};

/*
 * `GET /auth/<provider>/start` query. The app keeps the PKCE verifier and its own state; the address
 * book sends the browser back to `redirect_uri` with `code` and that `state`, or `error` and `state`.
 */
export const LoginStartQuerySchema = z.object({
    redirect_uri: z.string().refine(isAppRedirectUri, 'Not a redirect the app listens on'),
    state: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/, 'Expected at least 12 random bytes in base64url'),
    code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Expected a SHA-256 PKCE challenge in base64url'),
    code_challenge_method: z.literal('S256')
});
export type LoginStartQuery = z.infer<typeof LoginStartQuerySchema>;

// `POST /v1/session`: the one-time code from the redirect, with the verifier only the app that started the login holds.
export const SessionExchangePayloadSchema = z.object({
    code: TokenSchema,
    codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/, 'Expected a PKCE verifier'),
    redirectUri: z.string(),
    // What this device is called in the list of who got access, such as the machine's host name.
    label: z.string().min(1).max(80).optional()
});
export type SessionExchangePayload = z.infer<typeof SessionExchangePayloadSchema>;

// `POST /v1/session/refresh`. A refresh token works once; presenting a spent one ends the session.
export const SessionRefreshPayloadSchema = z.object({
    refreshToken: TokenSchema
});
export type SessionRefreshPayload = z.infer<typeof SessionRefreshPayloadSchema>;

export const AccountSchema = z.object({
    // What `machineRegistrationMessage` names, so a daemon agrees to exactly this account.
    id: z.string().min(1).max(64),
    provider: ProviderIdSchema,
    login: z.string().nullable()
});
export type Account = z.infer<typeof AccountSchema>;

// The answer to both session routes. `DELETE /v1/session` revokes the session the bearer belongs to.
export const SessionResultSchema = z.object({
    accessToken: TokenSchema,
    accessExpiresAt: z.number().int(),
    refreshToken: TokenSchema,
    expiresAt: z.number().int(),
    account: AccountSchema
});
export type SessionResult = z.infer<typeof SessionResultSchema>;

const MachineNameSchema = z.string().min(1).max(80);

// The daemon's `ProjectIconChoice` as it travels in `endpoint.info`, checked by the client that draws it.
export const MachineIconSchema = z.object({ kind: z.enum(['emoji', 'lucide']), value: z.string().min(1).max(64) });
export type MachineIcon = z.infer<typeof MachineIconSchema>;

export const MachineSchema = z.object({
    id: MachineIdSchema,
    name: MachineNameSchema,
    icon: MachineIconSchema.nullable(),
    publicKey: PublicKeySchema,
    // Milliseconds since the epoch of the latest registration; the address book never sees a machine online.
    lastSeenAt: z.number().int().nullable()
});
export type Machine = z.infer<typeof MachineSchema>;

// `GET /v1/machines`
export const MachineListResultSchema = z.object({
    machines: z.array(MachineSchema)
});
export type MachineListResult = z.infer<typeof MachineListResultSchema>;

/*
 * `POST /v1/machines`, sent by the client that sits on the machine, with the daemon's signature over
 * `machineRegistrationMessage`. The client cannot sign for the daemon's key, so a machine lands in
 * an account only when the daemon itself agreed to that account. Registering again replaces the name,
 * the icon and the key. The icon is not signed: it is decoration a signed-in client may set anyway.
 * `DELETE /v1/machines/<id>` takes a machine off the list and leaves its pairings alone.
 */
export const RegisterMachinePayloadSchema = z.object({
    id: MachineIdSchema,
    name: MachineNameSchema,
    icon: MachineIconSchema.nullable(),
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
 * `POST /v1/statements`: a signed-in client asking for a statement to show one machine. The nonce is
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

// The answer to `POST /v1/statements`. The address book's signature is over `accessStatementMessage`.
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

export const AddressBookErrorCodeSchema = z.enum(['bad-request', 'unauthorized', 'bad-signature', 'not-found', 'rate-limited', 'not-configured', 'internal']);
export type AddressBookErrorCode = z.infer<typeof AddressBookErrorCodeSchema>;

export const AddressBookErrorSchema = z.object({
    error: z.object({
        code: AddressBookErrorCodeSchema,
        message: z.string().max(512)
    })
});
export type AddressBookError = z.infer<typeof AddressBookErrorSchema>;
