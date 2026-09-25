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

// A provider is a way to sign in; an account holds one identity per provider.
export const ProviderIdSchema = z.enum(['github', 'apple']);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

// What a person reads for a provider, in a sentence or on a button.
export const PROVIDER_NAMES: Record<ProviderId, string> = { github: 'GitHub', apple: 'Apple' };

// 32 random bytes in base64url: access and refresh tokens, and the one-time login code.
export const TokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Expected a token');

// How far a refresh's `issuedAt` may lie from the address book's clock, either way.
export const SESSION_REFRESH_MAX_SKEW_MS = 600_000;

/*
 * Where the address book sends the browser back after a login: a custom scheme for an app that can
 * register one, a loopback listener on any port for one that cannot (RFC 8252, 7.1 and 7.3), or the
 * web client on its own origin. Nothing else: signing in opens machines, so an open redirect would let
 * a page anywhere start a login and collect the code. The dev entry is Vite's own origin, which only a
 * process on the same computer can serve.
 */
export const APP_REDIRECT_SCHEME_URI = 'ruimte://pulsar/callback';
export const APP_REDIRECT_LOOPBACK_PATH = '/pulsar/callback';
export const WEB_REDIRECT_URIS: readonly string[] = ['https://station.ruimte.app/pulsar/callback', 'http://localhost:5173/pulsar/callback'];

export const isAppRedirectUri = (value: string): boolean => {
    if (value === APP_REDIRECT_SCHEME_URI || WEB_REDIRECT_URIS.includes(value)) {
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
    code_challenge_method: z.literal('S256'),
    /*
     * A link token from `POST /v1/account/link`: this login adds an identity to the signed-in account
     * instead of opening a session, and the code it ends in goes to `POST /v1/account/identities`.
     */
    link: z
        .string()
        .regex(/^[A-Za-z0-9_-]{43}$/, 'Expected a token')
        .optional()
});
export type LoginStartQuery = z.infer<typeof LoginStartQuerySchema>;

// The primary App ID grouped with the web Services ID in Apple Developer.
export const APPLE_NATIVE_CLIENT_ID = 'app.ruimte.mobile';

export const NativeAppleStartPayloadSchema = z.object({ codeChallenge: TokenSchema });
export type NativeAppleStartPayload = z.infer<typeof NativeAppleStartPayloadSchema>;

export const NativeAppleStartResultSchema = z.object({
    attempt: TokenSchema,
    nonce: TokenSchema,
    expiresAt: z.number().int()
});
export type NativeAppleStartResult = z.infer<typeof NativeAppleStartResultSchema>;

export const NativeAppleCompletePayloadSchema = z.object({
    attempt: TokenSchema,
    identityToken: z.string().min(1).max(16384),
    authorizationCode: z.string().min(1).max(4096),
    // The credential's full name, which Apple hands the app only on the first authorization of an Apple ID.
    displayName: z.string().max(1024).optional()
});
export type NativeAppleCompletePayload = z.infer<typeof NativeAppleCompletePayloadSchema>;

// The same PKCE- and device-key-bound exchange as web login, without a browser redirect.
export const NativeAppleCompleteResultSchema = z.object({ code: TokenSchema });
export type NativeAppleCompleteResult = z.infer<typeof NativeAppleCompleteResultSchema>;

// `POST /v1/session`: the one-time code from the redirect, with the verifier only the app that started the login holds.
export const SessionExchangePayloadSchema = z.object({
    code: TokenSchema,
    codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/, 'Expected a PKCE verifier'),
    redirectUri: z.string(),
    // What this device is called in the list of who got access, such as the machine's host name.
    label: z.string().min(1).max(80).optional(),
    /*
     * The key every refresh of this session has to be signed with, and its signature over
     * `sessionKeyMessage`. A refresh token read off a disk or out of a page is worth nothing without it.
     */
    sessionKey: PublicKeySchema,
    sessionKeySignature: SignatureSchema
});
export type SessionExchangePayload = z.infer<typeof SessionExchangePayloadSchema>;

// What a page hands the side that holds the session key: the exchange without the key, which that side adds.
export const SessionLoginCodeSchema = SessionExchangePayloadSchema.omit({ sessionKey: true, sessionKeySignature: true });
export type SessionLoginCode = z.infer<typeof SessionLoginCodeSchema>;

/*
 * `POST /v1/session/refresh`. A refresh token works once; presenting a spent one ends the session. The
 * signature is over `sessionRefreshMessage` with the key the session was opened with.
 */
export const SessionRefreshPayloadSchema = z.object({
    refreshToken: TokenSchema,
    issuedAt: z.number().int().min(0),
    signature: SignatureSchema
});
export type SessionRefreshPayload = z.infer<typeof SessionRefreshPayloadSchema>;

export const AccountSchema = z.object({
    // What `machineRegistrationMessage` names, so a daemon agrees to exactly this account.
    id: z.string().min(1).max(64),
    /*
     * The identity the account is shown as: the first one with a login (Apple hands out none), else
     * the oldest. Not the one this session signed in with, so every client names the account alike.
     */
    provider: ProviderIdSchema,
    login: z.string().nullable(),
    /*
     * The name of the identity the account is shown as, else of the first identity in that order that
     * has one. Optional for an address book from before names; `null` when no identity has one.
     */
    displayName: z.string().nullable().optional()
});
export type Account = z.infer<typeof AccountSchema>;

// One way to sign in to an account. The provider's subject stays on the address book.
export const IdentitySchema = z.object({
    provider: ProviderIdSchema,
    login: z.string().nullable(),
    // The person's name at the provider. Apple tells it only on the first sign-in, so it can lag a rename there.
    displayName: z.string().nullable().optional(),
    createdAt: z.number().int()
});
export type Identity = z.infer<typeof IdentitySchema>;

// `GET /v1/account`, and the answer to linking or unlinking an identity.
export const AccountResultSchema = z.object({
    account: AccountSchema,
    identities: z.array(IdentitySchema)
});
export type AccountResult = z.infer<typeof AccountResultSchema>;

/*
 * `GET /v1/providers`: the providers this address book can sign in with right now. Strings rather than
 * `ProviderIdSchema`, so a client older than a new provider still reads the list and skips that entry.
 */
export const ProvidersResultSchema = z.object({
    providers: z.array(z.string().max(32))
});
export type ProvidersResult = z.infer<typeof ProvidersResultSchema>;

/*
 * `GET /v1/models/benchmarks`: the Intelligence Index of Artificial Analysis against its cost per task,
 * per model of Ruimte and per effort. Only what the comparison chart draws, since the terms of that data
 * allow a chart and not a copy. Strings rather than enums for the provider and the effort, so a client
 * older than a new one still reads the rest.
 */
export const BenchmarkPointSchema = z.object({
    // The id of the effort in the model's own manifest, `low` to `max`, or `off` and `thinking` for a switch.
    effort: z.string().max(32),
    intelligence: z.number(),
    // In USD.
    costPerTask: z.number()
});
export type BenchmarkPoint = z.infer<typeof BenchmarkPointSchema>;

export const BenchmarkModelSchema = z.object({
    // The model's slug in Ruimte.
    id: z.string().max(64),
    name: z.string().max(64),
    provider: z.string().max(32),
    legacy: z.boolean(),
    // Empty for a model nobody measured.
    points: z.array(BenchmarkPointSchema).max(16)
});
export type BenchmarkModel = z.infer<typeof BenchmarkModelSchema>;

export const ModelBenchmarksResultSchema = z.object({
    fetchedAt: z.number().int(),
    models: z.array(BenchmarkModelSchema).max(64)
});
export type ModelBenchmarksResult = z.infer<typeof ModelBenchmarksResultSchema>;

// `POST /v1/account/link`: a signed-in client asks to add another provider to its account.
export const IdentityLinkStartPayloadSchema = z.object({
    provider: ProviderIdSchema
});
export type IdentityLinkStartPayload = z.infer<typeof IdentityLinkStartPayloadSchema>;

/*
 * A single-use token for the start URL, bound to the session that asked for it. It only starts the
 * provider's login: the identity lands on the account once the same session trades the code with its
 * PKCE verifier, so a token that leaks from a URL adds nobody's identity.
 */
export const IdentityLinkStartResultSchema = z.object({
    linkToken: TokenSchema,
    expiresAt: z.number().int()
});
export type IdentityLinkStartResult = z.infer<typeof IdentityLinkStartResultSchema>;

// `POST /v1/account/identities`: the code a link login came back with, sent with the session that started it.
export const IdentityLinkCompletePayloadSchema = SessionExchangePayloadSchema.pick({ code: true, codeVerifier: true, redirectUri: true });
export type IdentityLinkCompletePayload = z.infer<typeof IdentityLinkCompletePayloadSchema>;

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
export const MachineIconSchema = z.object({ kind: z.literal('lucide'), value: z.string().min(1).max(64) });
export type MachineIcon = z.infer<typeof MachineIconSchema>;

// The broker a machine announces itself to, as it hands the URL to its clients.
export const BrokerUrlSchema = z
    .string()
    .max(512)
    .regex(/^wss?:\/\/[^\s]+$/, 'Expected a ws:// or wss:// URL');

export const MachineSchema = z.object({
    id: MachineIdSchema,
    name: MachineNameSchema,
    icon: MachineIconSchema.nullable(),
    publicKey: PublicKeySchema,
    // Where a client that has never reached this machine signals it; null for a machine on no broker.
    brokerUrl: BrokerUrlSchema.nullable(),
    // Milliseconds since the epoch of the latest registration; the address book never sees a machine online.
    lastSeenAt: z.number().int().nullable()
});
export type Machine = z.infer<typeof MachineSchema>;

// `GET /v1/machines`
export const MachineListResultSchema = z.object({
    machines: z.array(MachineSchema),
    // Machines a person took off this account, which no client puts back on its own. Absent from an older address book.
    removedMachineIds: z.array(MachineIdSchema).optional()
});
export type MachineListResult = z.infer<typeof MachineListResultSchema>;

/*
 * The daemon signs the account binding. Re-registration may update display data but cannot replace
 * the machine key; deleting an account entry leaves direct pairings intact.
 */
export const RegisterMachinePayloadSchema = z.object({
    id: MachineIdSchema,
    name: MachineNameSchema,
    icon: MachineIconSchema.nullable(),
    // Optional so a registration from before the broker still parses; absent is none.
    brokerUrl: BrokerUrlSchema.nullable().optional(),
    publicKey: PublicKeySchema,
    issuedAt: z.number().int().min(0),
    signature: SignatureSchema,
    /*
     * A client registering a machine it reached, rather than a person pressing a button. Refused with
     * `removed` for a machine a person took off the account; a registration without it takes the machine
     * back, which is the way back from a removal.
     */
    automatic: z.boolean().optional()
});
export type RegisterMachinePayload = z.infer<typeof RegisterMachinePayloadSchema>;

export const RegisterMachineResultSchema = z.object({
    machine: MachineSchema
});
export type RegisterMachineResult = z.infer<typeof RegisterMachineResultSchema>;

/*
 * `POST /v1/statements`: a signed-in client asking for a statement to show one machine. The client
 * picks the nonce fresh for every request and the machine spends it, so a statement opens that machine
 * once for that key; the signature over `accessRequestMessage` proves the client holds the key it names.
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

export const AddressBookErrorCodeSchema = z.enum([
    'bad-request',
    'unauthorized',
    'bad-signature',
    'not-found',
    'removed',
    // The identity signs in to another account; accounts are never merged.
    'identity-taken',
    // The account already has an identity of this provider.
    'provider-linked',
    // Removing this identity would leave the account without a way in.
    'last-identity',
    'rate-limited',
    'not-configured',
    // The benchmarks were never fetched yet, or never held a model this address book knows.
    'no-benchmarks',
    'internal'
]);
export type AddressBookErrorCode = z.infer<typeof AddressBookErrorCodeSchema>;

export const AddressBookErrorSchema = z.object({
    error: z.object({
        code: AddressBookErrorCodeSchema,
        message: z.string().max(512)
    })
});
export type AddressBookError = z.infer<typeof AddressBookErrorSchema>;
