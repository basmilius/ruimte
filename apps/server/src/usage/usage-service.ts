import type { UsageAccount, UsageSummaryPayload, UsageSummaryResult } from '@ruimte/contracts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import { accountOfRecord, aggregate } from './aggregate.ts';
import { ExchangeRates } from './exchange.ts';
import { PriceBook } from './pricing.ts';
import type { KnownProject } from './projects.ts';
import type { UsageRecord } from './record.ts';
import { UsageScanner, type ScanReport, type UsageScannerOptions } from './scanner.ts';
import type { UsageRootPath } from './roots.ts';
import { errorText } from '../error-text.ts';
import { ClientSinks } from '../client-sinks.ts';

/* A scan this fresh answers the question the page is asking, so nothing is opened for it. */
const SCAN_TTL_MS = 60_000;

export interface UsageServiceOptions {
    home: string;
    /* Off with `--no-price-fetch`: the bundled table then prices everything and no rate is asked for. */
    allowPriceFetch?: boolean;
    /* The projects the daemon knows, so a folder can wear the name it has in the app. */
    knownProjects(): Promise<KnownProject[]>;
    /* Where the transcripts are, asked again on every scan when a function. */
    roots?: UsageRootPath[] | (() => UsageRootPath[]);
    sessionAccounts?: UsageScannerOptions['sessionAccounts'];
    /* The accounts of the machine, for the page to filter by; absent names none. */
    accounts?: () => UsageAccount[];
}

/* The accounts of the machine, and after them any a record names that the machine no longer has, under its id. */
const withRecordAccounts = (accounts: UsageAccount[], records: readonly UsageRecord[]): UsageAccount[] => {
    const listed = new Set(accounts.map((account) => account.id));
    const gone: UsageAccount[] = [];
    for (const record of records) {
        const id = accountOfRecord(record);
        if (!listed.has(id)) {
            listed.add(id);
            gone.push({ id, kind: record.provider, label: id });
        }
    }
    return [...accounts, ...gone];
};

const EMPTY_SCAN: ScanReport = { at: 0, files: 0, changedFiles: 0, durationMs: 0, roots: [] };

/*
 * What the usage page asks the daemon. It owns one scanner and one price table for every client:
 * the transcripts are machine-wide, so a second person looking costs a second aggregation and not a
 * second scan. The scan runs when a request finds the last one stale and, while any client has the
 * page open, once a minute, which is what `usage.changed` announces.
 */
export class UsageService {
    private readonly scanner: UsageScanner;
    private readonly prices: PriceBook;
    private readonly rates: ExchangeRates;
    private readonly knownProjects: UsageServiceOptions['knownProjects'];
    private readonly accounts: (() => UsageAccount[]) | null;
    private readonly sinks = new ClientSinks((clientId) => this.unfollow(clientId));
    private readonly followers = new Set<string>();
    private report: ScanReport = EMPTY_SCAN;
    private failed = false;
    private inFlight: Promise<void> | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(options: UsageServiceOptions) {
        this.scanner = new UsageScanner(options.home, options.roots, options.sessionAccounts ? { sessionAccounts: options.sessionAccounts } : {});
        this.accounts = options.accounts ?? null;
        this.prices = new PriceBook(options.home, options.allowPriceFetch ?? true);
        this.rates = new ExchangeRates(options.home, options.allowPriceFetch ?? true);
        this.knownProjects = options.knownProjects;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* The page is open here: keep the numbers moving until it closes or the socket does. */
    follow(clientId: string): void {
        this.followers.add(clientId);
        this.timer ??= setInterval(() => {
            void this.rescan();
        }, SCAN_TTL_MS);
    }

    unfollow(clientId: string): void {
        this.followers.delete(clientId);
        if (this.followers.size === 0 && this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async summary(payload: UsageSummaryPayload): Promise<UsageSummaryResult> {
        if (Date.now() - this.report.at > SCAN_TTL_MS) {
            await this.rescan();
        }
        const records = this.scanner.records();
        const { buckets, models, projects, sessions } = await aggregate(records, payload, this.prices, await this.knownProjects());
        return {
            from: payload.from,
            to: payload.to,
            resolution: payload.resolution,
            timeZone: payload.timeZone,
            buckets,
            models,
            projects,
            sessions,
            scan: {
                at: this.report.at,
                files: this.report.files,
                changedFiles: this.report.changedFiles,
                durationMs: this.report.durationMs,
                running: this.inFlight !== null,
                failed: this.failed
            },
            pricing: this.prices.pricing,
            rate: this.rates.current,
            roots: this.report.roots,
            ...(this.accounts === null ? {} : { accounts: withRecordAccounts(this.accounts(), records) })
        };
    }

    stop(): void {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /* One pass at a time: a request that arrives while a pass runs waits for that one's answer. */
    private rescan(): Promise<void> {
        this.inFlight ??= this.runScan().finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }

    private async runScan(): Promise<void> {
        // The table and the rate are fetched beside the walk, so a slow answer never holds up the scan.
        const [report] = await Promise.all([
            this.scanner.scan().catch((e: unknown) => {
                console.error('The usage scan failed:', errorText(e));
                return null;
            }),
            this.prices.ensure(),
            this.rates.ensure()
        ]);
        this.failed = report === null;
        if (report === null) {
            // The last good numbers stay on screen; only the moment of the scan is not moved on.
            return;
        }
        this.report = report;
        if (report.changedFiles > 0) {
            this.emit({ event: 'usage.changed', payload: { scannedAt: report.at } });
        }
    }

    private emit(event: SessionEvent): void {
        this.sinks.emit(event);
    }
}
