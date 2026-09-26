import { z } from 'zod';
import { ProviderAccountIdSchema } from './provider-accounts.ts';

/* The CLIs whose transcripts the daemon reads. A subset of `AgentKindSchema`: it grows with the readers. */
export const UsageProviderSchema = z.enum(['claude', 'codex']);
export type UsageProvider = z.infer<typeof UsageProviderSchema>;
export const USAGE_PROVIDERS = UsageProviderSchema.options;

export const UsageResolutionSchema = z.enum(['hour', 'day']);
export type UsageResolution = z.infer<typeof UsageResolutionSchema>;

/* Token kinds are disjoint, so a total is their sum. Reasoning is a part of output and never counted twice. */
export const UsageTotalsSchema = z.object({
    calls: z.number().int().nonnegative(),
    /* Input that was neither read from nor written to the cache. */
    input: z.number().int().nonnegative(),
    cacheRead: z.number().int().nonnegative(),
    /* Every cache creation, the one hour kind included. */
    cacheWrite: z.number().int().nonnegative(),
    cacheWrite1h: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    reasoning: z.number().int().nonnegative()
});
export type UsageTotals = z.infer<typeof UsageTotalsSchema>;

export const EMPTY_TOTALS: UsageTotals = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0, reasoning: 0 };

export const totalTokensOf = (totals: UsageTotals): number => totals.input + totals.cacheRead + totals.cacheWrite + totals.output;

/* A sum of two rather than a change to either, so a total a client holds stays the one it drew. */
export const addTotals = (first: UsageTotals, second: UsageTotals): UsageTotals => ({
    calls: first.calls + second.calls,
    input: first.input + second.input,
    cacheRead: first.cacheRead + second.cacheRead,
    cacheWrite: first.cacheWrite + second.cacheWrite,
    cacheWrite1h: first.cacheWrite1h + second.cacheWrite1h,
    output: first.output + second.output,
    reasoning: first.reasoning + second.reasoning
});

/* An account a record can belong to, for the page to filter by and color with. The default account of a CLI has its kind as its id. */
export const UsageAccountSchema = z.object({
    id: ProviderAccountIdSchema,
    kind: UsageProviderSchema,
    label: z.string(),
    // A node accent name, as the account has it; absent on an account nobody gave one.
    color: z.string().optional()
});
export type UsageAccount = z.infer<typeof UsageAccountSchema>;

export const UsageBucketSchema = z.object({
    /* `YYYY-MM-DD` for a day, an ISO hour start for an hour, both in the time zone of the request. */
    slot: z.string(),
    provider: UsageProviderSchema,
    model: z.string(),
    // Only on a summary asked for with `accounts`, which splits every bucket per account.
    account: ProviderAccountIdSchema.optional(),
    totals: UsageTotalsSchema,
    /* Null when no price is known for the model, which is not the same as free. */
    costUsd: z.number().nullable(),
    cacheSavingsUsd: z.number(),
    sessions: z.number().int().nonnegative()
});
export type UsageBucket = z.infer<typeof UsageBucketSchema>;

/* Where a model's price came from, so the page can say so instead of showing a number of unknown origin. */
export const UsagePriceBasisSchema = z.enum(['exact', 'family', 'override', 'unknown']);
export type UsagePriceBasis = z.infer<typeof UsagePriceBasisSchema>;

export const UsageModelSchema = z.object({
    provider: UsageProviderSchema,
    model: z.string(),
    // Only on a summary asked for with `accounts`, which splits every model per account.
    account: ProviderAccountIdSchema.optional(),
    totals: UsageTotalsSchema,
    costUsd: z.number().nullable(),
    priceBasis: UsagePriceBasisSchema,
    /* The family key or the override the price came from, for the tooltip. */
    pricedAs: z.string().nullable()
});
export type UsageModel = z.infer<typeof UsageModelSchema>;

export const UsageProjectSchema = z.object({
    /* The git root of the working directory the calls were made in, or that directory itself. */
    folder: z.string(),
    name: z.string(),
    /* Set when the folder is a project the daemon knows, so the page can wear its name and icon. */
    projectId: z.string().nullable(),
    byProvider: z.partialRecord(UsageProviderSchema, z.object({ costUsd: z.number(), tokens: z.number().int() })),
    totals: UsageTotalsSchema,
    costUsd: z.number()
});
export type UsageProject = z.infer<typeof UsageProjectSchema>;

export const UsageSummaryPayloadSchema = z.object({
    /* `YYYY-MM-DD`, both ends included, read in `timeZone`. */
    from: z.string(),
    to: z.string(),
    resolution: UsageResolutionSchema,
    /* IANA name. The daemon may stand on another machine, so the viewer's days travel with the request. */
    timeZone: z.string(),
    /* Only the usage of these accounts, with buckets and models apart per account. Absent is every account, folded as before accounts. */
    accounts: z.array(ProviderAccountIdSchema).optional()
});
export type UsageSummaryPayload = z.infer<typeof UsageSummaryPayloadSchema>;

export const UsageScanSchema = z.object({
    at: z.number(),
    files: z.number().int().nonnegative(),
    changedFiles: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    running: z.boolean(),
    failed: z.boolean()
});
export type UsageScan = z.infer<typeof UsageScanSchema>;

export const UsagePricingSchema = z.object({
    source: z.enum(['litellm', 'snapshot', 'none']),
    fetchedAt: z.number().nullable(),
    models: z.number().int().nonnegative()
});
export type UsagePricing = z.infer<typeof UsagePricingSchema>;

export const UsageRootSchema = z.object({
    provider: UsageProviderSchema,
    path: z.string(),
    status: z.enum(['ok', 'missing', 'failed']),
    message: z.string().nullable()
});
export type UsageRoot = z.infer<typeof UsageRootSchema>;

/* The day's ECB reference rate for one dollar, so a page can show what a call cost in its own money. */
export const UsageRateSchema = z.object({
    currency: z.string(),
    rate: z.number().positive(),
    /* The day the rate is of, as the bank publishes it: `YYYY-MM-DD`. */
    date: z.string(),
    fetchedAt: z.number()
});
export type UsageRate = z.infer<typeof UsageRateSchema>;

export const UsageSummaryResultSchema = z.object({
    from: z.string(),
    to: z.string(),
    resolution: UsageResolutionSchema,
    timeZone: z.string(),
    buckets: z.array(UsageBucketSchema),
    models: z.array(UsageModelSchema),
    projects: z.array(UsageProjectSchema),
    /* Distinct over the whole period; a session spans days and models, so the buckets cannot say it. */
    sessions: z.number().int().nonnegative(),
    scan: UsageScanSchema,
    pricing: UsagePricingSchema,
    /* Null while no rate has been fetched, which is how the page knows to stay in dollars. */
    rate: UsageRateSchema.nullable(),
    roots: z.array(UsageRootSchema),
    // Every account of the machine, and any a record still names after it was removed.
    accounts: z.array(UsageAccountSchema).optional()
});
export type UsageSummaryResult = z.infer<typeof UsageSummaryResultSchema>;

/* Only the moment: whoever cares asks for the period it has open. */
export const UsageChangedEventSchema = z.object({ scannedAt: z.number() });
export type UsageChangedEvent = z.infer<typeof UsageChangedEventSchema>;

export const UsageWindowSchema = z.object({
    /* Stable per provider, so a sparse mid-turn event lands on the row a full read drew. */
    id: z.string(),
    kind: z.enum(['session', 'weekly', 'monthly', 'other']),
    label: z.string(),
    /* A fraction, like the context meter; a percent is a view concern. */
    used: z.number().min(0).max(1),
    /* Epoch milliseconds, null when the provider named none. */
    resetsAt: z.number().int().nullable(),
    durationMs: z.number().int().nullable()
});
export type UsageWindow = z.infer<typeof UsageWindowSchema>;

export const UsageLimitsProviderSchema = z.object({
    kind: UsageProviderSchema,
    /* The account these numbers are of. The default account of a kind comes first, in the shape an entry had before accounts. */
    account: UsageAccountSchema.omit({ kind: true }).optional(),
    /* As the provider names it: `max`, `pro`, `ChatGPT Pro`. */
    plan: z.string().nullable(),
    checkedAt: z.number().int(),
    /* What produced these numbers: a read of our own, or an event from a running turn. */
    source: z.enum(['probe', 'event']),
    windows: z.array(UsageWindowSchema),
    cost: z.object({ sessionUsd: z.number().nonnegative() }).nullable(),
    unavailable: z
        .object({
            reason: z.enum(['not-installed', 'no-subscription', 'failed']),
            message: z.string().nullable()
        })
        .nullable()
});
export type UsageLimitsProvider = z.infer<typeof UsageLimitsProviderSchema>;

export const UsageLimitsSnapshotSchema = z.object({ providers: z.array(UsageLimitsProviderSchema) });
export type UsageLimitsSnapshot = z.infer<typeof UsageLimitsSnapshotSchema>;
