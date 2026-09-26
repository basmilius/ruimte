import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { UsagePriceBasis, UsagePricing, UsageTotals } from '@ruimte/agent-contracts';
import { isNotFound, writeAtomic } from '../fs.ts';
import { errorText } from '../error-text.ts';
import bundled from './prices-snapshot.json' with { type: 'json' };

export const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

/* A table a day old still prices everything anyone ran today, and nobody has to be online for it. */
const TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

/* What Anthropic charges over the base input rate when the table itself says nothing. */
const CACHE_READ_SHARE = 0.1;
const CACHE_WRITE_SHARE = 1.25;
const CACHE_WRITE_1H_SHARE = 2;

export interface ModelPrice {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheWrite1h: number;
}

export type PriceTable = Map<string, ModelPrice>;

export interface PriceLookup {
    price: ModelPrice | null;
    basis: UsagePriceBasis;
    /* The key the price was found under, when that is not the model's own name. */
    pricedAs: string | null;
}

/* A bare family name prices nothing: `opus` and `sonnet` are several models with several prices. */
const AMBIGUOUS = new Set(['opus', 'sonnet', 'haiku', 'fable', 'gpt', 'codex', 'synthetic', '<synthetic>']);

const PROVIDERS = new Set(['anthropic', 'openai']);
const MODES = new Set(['chat', 'responses']);

interface LiteLlmEntry {
    input_cost_per_token?: unknown;
    output_cost_per_token?: unknown;
    cache_read_input_token_cost?: unknown;
    cache_creation_input_token_cost?: unknown;
    litellm_provider?: unknown;
    mode?: unknown;
}

const rate = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/*
 * The LiteLLM table as this app needs it: the Anthropic and OpenAI chat and responses models, keyed
 * by the lowercase name and by the bare name behind a provider prefix. A model priced on one side
 * only is dropped, because half a price reads as a cheap model rather than an unknown one.
 */
export const parsePriceTable = (document: unknown): PriceTable => {
    const table: PriceTable = new Map();
    if (typeof document !== 'object' || document === null) {
        return table;
    }
    for (const [name, value] of Object.entries(document as Record<string, LiteLlmEntry>)) {
        if (typeof value !== 'object' || value === null) {
            continue;
        }
        if (typeof value.litellm_provider !== 'string' || !PROVIDERS.has(value.litellm_provider)) {
            continue;
        }
        if (typeof value.mode !== 'string' || !MODES.has(value.mode)) {
            continue;
        }
        const input = rate(value.input_cost_per_token);
        const output = rate(value.output_cost_per_token);
        if (input === null || output === null) {
            continue;
        }
        const price: ModelPrice = {
            input,
            output,
            cacheRead: rate(value.cache_read_input_token_cost) ?? input * CACHE_READ_SHARE,
            cacheWrite: rate(value.cache_creation_input_token_cost) ?? input * CACHE_WRITE_SHARE,
            cacheWrite1h: input * CACHE_WRITE_1H_SHARE
        };
        const key = name.trim().toLowerCase();
        table.set(key, price);
        const bare = key.slice(key.lastIndexOf('/') + 1);
        if (bare !== key && !table.has(bare)) {
            table.set(bare, price);
        }
    }
    return table;
};

/* `claude-opus-4-5-20251101` is the same model as `claude-opus-4-5`, dated. */
const withoutDate = (key: string): string | null => {
    const match = /^(.*)-\d{6,8}$/.exec(key);
    return match === null ? null : match[1]!;
};

/*
 * Exact first, then the same name without its date, then the longest family the table knows. A name
 * nobody prices is left unpriced rather than guessed at: `$0.00` for a model that costs money is a
 * worse answer than a question mark.
 */
export const lookupPrice = (table: PriceTable, model: string): PriceLookup => {
    const key = model.trim().toLowerCase().split('[')[0]!;
    const bare = key.slice(key.lastIndexOf('/') + 1);
    if (bare === '' || AMBIGUOUS.has(bare)) {
        return { price: null, basis: 'unknown', pricedAs: null };
    }
    const exact = table.get(key) ?? table.get(bare);
    if (exact !== undefined) {
        return { price: exact, basis: 'exact', pricedAs: null };
    }
    const dated = withoutDate(bare);
    const undated = dated === null ? undefined : table.get(dated);
    if (undated !== undefined && dated !== null) {
        return { price: undated, basis: 'exact', pricedAs: dated };
    }
    for (let family = dated ?? bare; family.includes('-');) {
        family = family.slice(0, family.lastIndexOf('-'));
        const found = AMBIGUOUS.has(family) ? undefined : table.get(family);
        if (found !== undefined) {
            return { price: found, basis: 'family', pricedAs: family };
        }
    }
    return { price: null, basis: 'unknown', pricedAs: null };
};

/* Reasoning tokens are a part of the output and are never charged a second time. */
export const costOf = (totals: UsageTotals, price: ModelPrice): number =>
    totals.input * price.input +
    totals.cacheRead * price.cacheRead +
    Math.max(0, totals.cacheWrite - totals.cacheWrite1h) * price.cacheWrite +
    totals.cacheWrite1h * price.cacheWrite1h +
    totals.output * price.output;

/* What reading from the cache saved against sending the same tokens again. The premium a write
   costs is not taken off: it was paid for the turn that wrote, not for the ones that read. */
export const cacheSavingsOf = (totals: UsageTotals, price: ModelPrice): number => totals.cacheRead * (price.input - price.cacheRead);

interface Snapshot {
    fetchedAt: number;
    document: unknown;
}

/*
 * One price table for the whole host. It starts on the snapshot that ships with the app, so the
 * first page ever opened already carries prices, then reads the newer copy on disk, then asks
 * LiteLLM once a day. Every step is optional: with the fetch off and nothing on disk the bundled
 * table is what prices everything.
 */
export class PriceBook {
    private readonly home: string;
    private readonly allowFetch: boolean;
    private table: PriceTable;
    private source: UsagePricing['source'] = 'snapshot';
    private fetchedAt: number | null = null;
    private loadedFromDisk = false;
    private inFlight: Promise<void> | null = null;

    constructor(home: string, allowFetch = true) {
        this.home = home;
        this.allowFetch = allowFetch;
        this.table = parsePriceTable(bundled);
    }

    get pricing(): UsagePricing {
        return { source: this.table.size === 0 ? 'none' : this.source, fetchedAt: this.fetchedAt, models: this.table.size };
    }

    look(model: string): PriceLookup {
        return lookupPrice(this.table, model);
    }

    /* Refreshes at most one table at a time; a second caller waits for the first one's answer. */
    ensure(): Promise<void> {
        this.inFlight ??= this.refresh().finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }

    private get file(): string {
        return join(this.home, 'usage', 'prices.json');
    }

    private async refresh(): Promise<void> {
        if (!this.loadedFromDisk) {
            this.loadedFromDisk = true;
            try {
                const snapshot = JSON.parse(await readFile(this.file, 'utf8')) as Snapshot;
                const table = parsePriceTable(snapshot?.document);
                if (table.size > 0 && typeof snapshot.fetchedAt === 'number') {
                    this.table = table;
                    this.source = 'litellm';
                    this.fetchedAt = snapshot.fetchedAt;
                }
            } catch (e) {
                if (!isNotFound(e)) {
                    console.warn('The stored price table would not read; using the bundled one:', errorText(e));
                }
            }
        }
        if (!this.allowFetch || (this.fetchedAt !== null && Date.now() - this.fetchedAt < TTL_MS)) {
            return;
        }
        try {
            const response = await fetch(LITELLM_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
            if (!response.ok) {
                throw new Error(`LiteLLM answered ${response.status}`);
            }
            const document: unknown = await response.json();
            const table = parsePriceTable(document);
            if (table.size === 0) {
                throw new Error('The LiteLLM table held no model this app prices');
            }
            this.table = table;
            this.source = 'litellm';
            this.fetchedAt = Date.now();
            await mkdir(join(this.home, 'usage'), { recursive: true, mode: 0o700 });
            await writeAtomic(this.file, JSON.stringify({ fetchedAt: this.fetchedAt, document } satisfies Snapshot));
        } catch (e) {
            // Whatever is loaded keeps pricing; a table that could not be refreshed is not a failure.
            console.warn('Could not refresh the price table:', errorText(e));
        }
    }
}
