import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ModelCatalogDataSchema, type AgentKind } from '@ruimte/contracts';
import type { ModelCatalog } from '@ruimte/agents/providers/catalog';
import { isNotFound, writeAtomic } from '@ruimte/agents/fs';
import { AddressBookClient, type ModelCatalogsResult } from '@ruimte/pulsar';
import { z } from 'zod';
import { errorText } from '../error-text.ts';

// A new model reaches a machine within hours of a deploy of the address book, which is soon enough.
const TTL_MS = 6 * 60 * 60 * 1000;
// Asked on every `provider.list`, so an address book that is down is only knocked on this often.
const RETRY_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

// Each catalog is checked on its own, so one this version cannot read leaves the others standing.
const StoredSchema = z.object({ fetchedAt: z.number(), catalogs: z.record(z.string(), z.unknown()) });

interface ModelCatalogFeedOptions {
    home: string;
    catalogs: Partial<Record<AgentKind, ModelCatalog>>;
    // Off keeps every catalog on what the app shipped with and what is on disk.
    allowFetch: boolean;
    fetchCatalogs?: () => Promise<ModelCatalogsResult>;
    now?: () => number;
}

const fromAddressBook = (): Promise<ModelCatalogsResult> =>
    new AddressBookClient({ fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }) }).modelCatalogs();

/*
 * The model catalogs of the chat CLIs, newer than the ones the app shipped with once the address book
 * has a newer copy, so a new model needs no release. A copy that is missing, unreadable or older than
 * the shipped one changes nothing, and a fetch that fails is never an error.
 */
export class ModelCatalogFeed {
    private readonly options: ModelCatalogFeedOptions;
    private readonly fetchCatalogs: () => Promise<ModelCatalogsResult>;
    private readonly now: () => number;
    private fetchedAt: number | null = null;
    private attemptedAt: number | null = null;
    private inFlight: Promise<void> | null = null;

    constructor(options: ModelCatalogFeedOptions) {
        this.options = options;
        this.fetchCatalogs = options.fetchCatalogs ?? fromAddressBook;
        this.now = options.now ?? Date.now;
    }

    /* Before any chat reads a catalog, so a chat on a model only the stored copy knows keeps it over a restart. */
    async load(): Promise<void> {
        let raw: unknown;
        try {
            raw = JSON.parse(await readFile(this.file, 'utf8'));
        } catch (e) {
            if (!isNotFound(e)) {
                console.warn('The stored model catalogs would not read; using the shipped ones:', errorText(e));
            }
            return;
        }
        const stored = StoredSchema.safeParse(raw);
        if (!stored.success) {
            console.warn('The stored model catalogs are not in a shape this version reads; using the shipped ones');
            return;
        }
        this.apply(stored.data.catalogs);
        this.fetchedAt = stored.data.fetchedAt;
    }

    /* One request at a time; a second caller waits for the first one's answer. */
    refresh(): Promise<void> {
        this.inFlight ??= this.fetch().finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }

    private get file(): string {
        return join(this.options.home, 'models', 'catalogs.json');
    }

    private async fetch(): Promise<void> {
        const now = this.now();
        // A time in the future means the clock went back; that copy counts as old.
        const within = (since: number | null, window: number): boolean => since !== null && now >= since && now - since < window;
        if (!this.options.allowFetch || within(this.fetchedAt, TTL_MS) || within(this.attemptedAt, RETRY_MS)) {
            return;
        }
        this.attemptedAt = now;
        try {
            const { catalogs } = await this.fetchCatalogs();
            if (this.apply(catalogs)) {
                console.log('Model catalogs updated from the address book');
            }
            this.fetchedAt = now;
            await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
            await writeAtomic(this.file, JSON.stringify({ fetchedAt: now, catalogs }));
        } catch (e) {
            console.warn('Could not refresh the model catalogs:', errorText(e));
        }
    }

    private apply(catalogs: Record<string, unknown>): boolean {
        let changed = false;
        for (const [kind, catalog] of Object.entries(this.options.catalogs)) {
            const data = ModelCatalogDataSchema.safeParse(catalogs[kind]);
            if (data.success && catalog.replace(data.data)) {
                changed = true;
            }
        }
        return changed;
    }
}
