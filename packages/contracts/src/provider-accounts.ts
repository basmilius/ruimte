import { z } from 'zod';

/*
 * An account of an agent CLI is one config folder of that CLI, handed to it through the variable it
 * reads its folder from. The person signs in with the CLI itself; the daemon only asks the CLI who
 * that is. Accounts belong to one machine and live in `$RUIMTE_HOME/providers.json`.
 */

/* A slug, never a path. The default account of a CLI has the CLI's kind as its id. */
export const ProviderAccountIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export type ProviderAccountId = z.infer<typeof ProviderAccountIdSchema>;

export const ProviderAccountSchema = z.object({
    // An agent kind. A kind this version does not know still parses, so the entry is written back unchanged.
    kind: z.string().min(1),
    label: z.string().optional(),
    // One of the note colors (`NOTE_COLOR_NAMES`).
    color: z.string().optional(),
    // Absent is on. An account that is off is left out of every picker.
    enabled: z.boolean().optional(),
    // The CLI's config folder, `~` allowed. Absent on the default account, which uses the CLI's own folder.
    home: z.string().min(1).optional(),
    // Codex only: a folder of its own for the login, sharing everything else with `home`.
    shadowHome: z.string().min(1).optional()
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
    statuses: z.array(ProviderAccountStatusSchema)
});
export type ProviderAccounts = z.infer<typeof ProviderAccountsSchema>;

/* The whole map: an id left out is removed, and its folder stays where it is. */
export const ProviderAccountsSavePayloadSchema = z.object({
    accounts: ProviderAccountMapSchema
});
export type ProviderAccountsSavePayload = z.infer<typeof ProviderAccountsSavePayloadSchema>;
