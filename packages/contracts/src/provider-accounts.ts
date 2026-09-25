import { z } from 'zod';
import { AgentKindSchema } from './agent.ts';

/*
 * An account of an agent CLI is one config folder of that CLI, handed to it through the variable it
 * reads its folder from. The person signs in with the CLI itself; the daemon only asks the CLI who
 * that is. Accounts belong to one machine and live in `$RUIMTE_HOME/providers.json`.
 */

/* A slug, never a path. The default account of a CLI has the CLI's kind as its id. */
export const ProviderAccountIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export type ProviderAccountId = z.infer<typeof ProviderAccountIdSchema>;

/*
 * A variable the CLI of an account is started with. A sensitive value lives in the keychain of the
 * machine and never on the wire: the daemon sends it as an empty `value` with `valueRedacted`, and a
 * save that sends that back keeps what the keychain holds.
 */
export const ProviderAccountVariableSchema = z.object({
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),
    value: z.string(),
    sensitive: z.boolean(),
    valueRedacted: z.boolean().optional()
});
export type ProviderAccountVariable = z.infer<typeof ProviderAccountVariableSchema>;

export const ProviderAccountSchema = z.object({
    // An agent kind. A kind this version does not know still parses, so the entry is written back unchanged.
    kind: z.string().min(1),
    label: z.string().optional(),
    // A node accent name (`NODE_ACCENT_NAMES`), kept a plain string so an older name is written back; the client paints any other with its accent.
    color: z.string().optional(),
    // Absent is on. An account that is off is left out of every picker.
    enabled: z.boolean().optional(),
    // The CLI's config folder, `~` allowed. Absent on the default account, which uses the CLI's own folder.
    home: z.string().min(1).optional(),
    // Codex only: a folder of its own for the login, sharing everything else with `home`.
    shadowHome: z.string().min(1).optional(),
    // Set on the CLI's environment after the login variables are taken off, so a key here is one a person chose.
    env: z.array(ProviderAccountVariableSchema).optional()
});
export type ProviderAccount = z.infer<typeof ProviderAccountSchema>;

export const ProviderAccountStateSchema = z.enum([
    'checking',
    'disabled',
    // The CLI is not installed on this machine.
    'not-found',
    'signed-out',
    'ready',
    'folder-missing',
    // A kind this version does not know, or a CLI with no variable for its config folder.
    'unavailable',
    'failed'
]);
export type ProviderAccountState = z.infer<typeof ProviderAccountStateSchema>;

/* What the CLI said about an account the last time it was asked. Never stored: the CLI is the truth. */
export const ProviderAccountStatusSchema = z.object({
    id: ProviderAccountIdSchema,
    kind: z.string(),
    state: ProviderAccountStateSchema,
    email: z.string().nullable(),
    plan: z.string().nullable(),
    organization: z.string().nullable(),
    // The folder the CLI is started with, resolved; empty for a CLI without a config folder variable.
    home: z.string(),
    // Where the account's conversations are written, resolved: a chat goes on under another account only when both write here.
    transcripts: z.string().optional(),
    // Why the state is what it is, in a sentence, when the CLI or the daemon said.
    message: z.string().nullable(),
    // Milliseconds since the epoch; 0 while the account was never checked.
    checkedAt: z.number()
});
export type ProviderAccountStatus = z.infer<typeof ProviderAccountStatusSchema>;

export const ProviderAccountMapSchema = z.record(ProviderAccountIdSchema, ProviderAccountSchema);
export type ProviderAccountMap = z.infer<typeof ProviderAccountMapSchema>;

export const ProviderAccountsSchema = z.object({
    accounts: ProviderAccountMapSchema,
    statuses: z.array(ProviderAccountStatusSchema),
    // Whether this machine can keep a sensitive variable; false off macOS, where no keychain is used.
    secretsAvailable: z.boolean().optional(),
    // Per agent kind, what a terminal types to sign that CLI in under an account, which the account's environment points at.
    loginCommands: z.partialRecord(AgentKindSchema, z.string()).optional()
});
export type ProviderAccounts = z.infer<typeof ProviderAccountsSchema>;

/* The whole map: an id left out is removed, and its folder stays where it is. */
export const ProviderAccountsSavePayloadSchema = z.object({
    accounts: ProviderAccountMapSchema
});
export type ProviderAccountsSavePayload = z.infer<typeof ProviderAccountsSavePayloadSchema>;

/* An account in a folder the daemon makes for it under `$RUIMTE_HOME/accounts`; a Codex one is a shadow home over the CLI's own folder. */
export const ProviderAccountCreatePayloadSchema = z.object({
    kind: AgentKindSchema,
    label: z.string().trim().min(1).max(80),
    color: z.string().optional()
});
export type ProviderAccountCreatePayload = z.infer<typeof ProviderAccountCreatePayloadSchema>;

export const ProviderAccountCreateResultSchema = ProviderAccountsSchema.extend({
    // The id the daemon minted from the label.
    id: ProviderAccountIdSchema
});
export type ProviderAccountCreateResult = z.infer<typeof ProviderAccountCreateResultSchema>;

/* Asks the CLI of one account again every few seconds until it is signed in, for a login running in a terminal. */
export const ProviderAccountWatchLoginPayloadSchema = z.object({
    id: ProviderAccountIdSchema
});
export type ProviderAccountWatchLoginPayload = z.infer<typeof ProviderAccountWatchLoginPayloadSchema>;
