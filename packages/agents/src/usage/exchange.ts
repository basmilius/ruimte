import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { UsageRate } from '@ruimte/agent-contracts';
import { isNotFound, writeAtomic } from '../fs.ts';
import { errorText } from '../error-text.ts';

export const FRANKFURTER_URL = 'https://api.frankfurter.app/latest';

/* The bank publishes one rate a day, so a rate a day old is the rate. */
const TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

/* The one currency the page offers next to dollars. Every price the host knows is in dollars. */
export const TARGET_CURRENCY = 'EUR';

export const parseRate = (document: unknown, currency: string): Omit<UsageRate, 'fetchedAt'> | null => {
    const body = typeof document === 'object' && document !== null ? (document as Record<string, unknown>) : null;
    const rates = body === null || typeof body.rates !== 'object' || body.rates === null ? null : (body.rates as Record<string, unknown>);
    const rate = rates === null ? undefined : rates[currency];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || typeof body?.date !== 'string') {
        return null;
    }
    return { currency, rate, date: body.date };
};

/*
 * What a dollar is worth in euros, asked of the ECB through frankfurter.app once a day and kept on
 * disk between runs. It is the same shape as the price table: the page works without it and simply
 * stays in dollars, so nothing here is allowed to hold up a scan or fail one.
 */
export class ExchangeRates {
    private readonly home: string;
    private readonly allowFetch: boolean;
    private rate: UsageRate | null = null;
    private loadedFromDisk = false;
    private inFlight: Promise<void> | null = null;

    constructor(home: string, allowFetch = true) {
        this.home = home;
        this.allowFetch = allowFetch;
    }

    get current(): UsageRate | null {
        return this.rate;
    }

    /* Refreshes at most one rate at a time; a second caller waits for the first one's answer. */
    ensure(): Promise<void> {
        this.inFlight ??= this.refresh().finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }

    private get file(): string {
        return join(this.home, 'usage', 'exchange-rate.json');
    }

    private async refresh(): Promise<void> {
        if (!this.loadedFromDisk) {
            this.loadedFromDisk = true;
            try {
                const stored = JSON.parse(await readFile(this.file, 'utf8')) as UsageRate;
                if (stored?.currency === TARGET_CURRENCY && typeof stored.rate === 'number' && stored.rate > 0) {
                    this.rate = stored;
                }
            } catch (e) {
                if (!isNotFound(e)) {
                    console.warn('The stored exchange rate would not read; asking for a new one:', errorText(e));
                }
            }
        }
        if (!this.allowFetch || (this.rate !== null && Date.now() - this.rate.fetchedAt < TTL_MS)) {
            return;
        }
        try {
            const response = await fetch(`${FRANKFURTER_URL}?from=USD&to=${TARGET_CURRENCY}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
            if (!response.ok) {
                throw new Error(`frankfurter.app answered ${response.status}`);
            }
            const parsed = parseRate(await response.json(), TARGET_CURRENCY);
            if (parsed === null) {
                throw new Error(`The answer carried no ${TARGET_CURRENCY} rate`);
            }
            this.rate = { ...parsed, fetchedAt: Date.now() };
            await mkdir(join(this.home, 'usage'), { recursive: true, mode: 0o700 });
            await writeAtomic(this.file, JSON.stringify(this.rate));
        } catch (e) {
            // Yesterday's rate still converts; a rate that could not be refreshed is not a failure.
            console.warn('Could not refresh the exchange rate:', errorText(e));
        }
    }
}
