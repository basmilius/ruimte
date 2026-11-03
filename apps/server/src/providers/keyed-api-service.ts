import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { z } from 'zod';
import { isNotFound, Serializer, writeAtomic } from '@adecore/agents';
import { hostUsageLine } from '@adecore/agents/usage';
import { ModelCatalog } from '@adecore/agents/providers';

export type ApiFetch = (url: string, init?: RequestInit) => Promise<Response>;

interface RunSettings {
    autoContinue: boolean;
    roundsPerRun: number;
    runs: number;
}

interface KeyedApiStatus<Settings> {
    configured: boolean;
    models: number;
    settings: Settings;
}

export type CatalogContent = Omit<Parameters<ModelCatalog['replace']>[0], 'updatedAt'>;

/* The sentences a person reads, which name the provider. */
interface KeyedApiWords {
    notLoaded: string;
    enterKey: string;
    noModels: string;
    unreadableKey: string;
    unloggedCall: string;
}

interface KeyedApiOptions<Settings> {
    folder: string;
    settingsSchema: z.ZodType<Settings>;
    defaults: Settings;
    words: KeyedApiWords;
}

const CREDENTIAL_FILE = 'credential';
const MODELS_FILE = 'models.json';
const SETTINGS_FILE = 'settings.json';

/*
 * A provider with no CLI, reached with an API key a person typed into Settings. The key, the models and the settings live
 * in a folder of `$RUIMTE_HOME`, the key in a 0600 file in a 0700 folder like the secrets of launches. No client reads the
 * folder (`MachineHome` keeps it closed) and no tool reaches it; the only reader is the chat backend. NanoGPT's puts the key in
 * the header of its own requests, the Claude API's hands it to Claude Code as `ANTHROPIC_API_KEY`, and nowhere else.
 */
export abstract class KeyedApiService<Settings extends RunSettings, Model> {
    readonly catalog = new ModelCatalog({ defaultModel: '', profiles: {}, models: [] });
    readonly request: ApiFetch;
    protected models: Model[] = [];
    protected settings: Settings;
    private home: string | null = null;
    private key = '';
    private readonly options: KeyedApiOptions<Settings>;
    private readonly writes = new Serializer();
    private readonly changeListeners = new Set<() => void>();

    protected constructor(request: ApiFetch, options: KeyedApiOptions<Settings>) {
        this.request = request;
        this.options = options;
        this.settings = options.defaults;
    }

    /* Where the key, the models and the conversations are, once `load` named the home. */
    get directory(): string {
        if (this.home === null) {
            throw new Error(this.options.words.notLoaded);
        }

        return join(this.home, this.options.folder);
    }

    /* One log file a month of every call a chat made, which the usage page reads like a transcript. */
    get usageDirectory(): string {
        return join(this.directory, 'usage');
    }

    get apiKey(): string {
        return this.key;
    }

    /* Told when the key or the models changed, so the provider list goes out again. */
    onChange(listener: () => void): () => void {
        this.changeListeners.add(listener);

        return () => this.changeListeners.delete(listener);
    }

    status(): KeyedApiStatus<Settings> {
        return { configured: this.key !== '', models: this.models.length, settings: this.settings };
    }

    /* The cut of a run of tool rounds, as a person set it: without automatic continuing a chat gets one run. */
    runLimits(): { roundsPerRun: number; runs: number } {
        const { autoContinue, roundsPerRun, runs } = this.settings;

        return { roundsPerRun, runs: autoContinue ? runs : 1 };
    }

    /* Keeps what a person changed, within what the wire allows, for the chats that start their next run after it. */
    setSettings(change: Partial<Settings>): Promise<KeyedApiStatus<Settings>> {
        return this.writes.run(async () => {
            this.settings = this.options.settingsSchema.parse({ ...this.settings, ...change });
            await mkdir(this.directory, { recursive: true, mode: 0o700 });
            await writeAtomic(join(this.directory, SETTINGS_FILE), JSON.stringify(this.settings), 0o600);

            return this.status();
        });
    }

    async load(home: string): Promise<void> {
        this.home = home;
        this.key = '';
        this.settings = this.options.defaults;
        this.setModels([]);
        await mkdir(this.directory, { recursive: true, mode: 0o700 });

        try {
            this.key = (await readFile(join(this.directory, CREDENTIAL_FILE), 'utf8')).trim();
        } catch (e) {
            if (!isNotFound(e)) {
                // Not the error itself: a parser or a path in it says nothing a person can act on here.
                console.warn(this.options.words.unreadableKey);
            }
        }

        try {
            const saved = this.options.settingsSchema.safeParse(JSON.parse(await readFile(join(this.directory, SETTINGS_FILE), 'utf8')));

            if (saved.success) {
                this.settings = saved.data;
            }
        } catch {
            // No settings yet, or ones this version cannot read: the defaults hold.
        }

        try {
            this.setModels(this.parseModelsFile(JSON.parse(await readFile(join(this.directory, MODELS_FILE), 'utf8'))));
        } catch {
            // A missing or stale list is fetched again on the next save or refresh.
        }
    }

    /*
     * An empty key disconnects, a key replaces the saved one once the API accepts it, and no key at all fetches the
     * models again with the saved one.
     */
    configure(apiKey?: string): Promise<KeyedApiStatus<Settings>> {
        return this.writes.run(async () => {
            if (apiKey === '') {
                await rm(join(this.directory, CREDENTIAL_FILE), { force: true });
                await rm(join(this.directory, MODELS_FILE), { force: true });
                this.key = '';
                this.setModels([]);

                return this.status();
            }

            const key = apiKey?.trim() ?? this.key;

            if (key === '' || /\s/.test(key)) {
                throw new Error(this.options.words.enterKey);
            }

            const models = await this.fetchModels(key);

            if (models.length === 0) {
                throw new Error(this.options.words.noModels);
            }

            await mkdir(this.directory, { recursive: true, mode: 0o700 });

            if (apiKey !== undefined) {
                await writeAtomic(join(this.directory, CREDENTIAL_FILE), key, 0o600, { durable: true });
                this.key = key;
            }

            await writeAtomic(join(this.directory, MODELS_FILE), JSON.stringify(this.modelsFile(models)), 0o600);
            this.setModels(models);

            return this.status();
        });
    }

    /* Builds the catalog again from the models it has, for when what it is built from beside them changed. */
    rebuildCatalog(): void {
        this.setModels(this.models);
    }

    /* Never fails a turn: a call that was made counts whether or not its line could be written. */
    protected async appendUsage(usage: Omit<Parameters<typeof hostUsageLine>[0], 'at'>): Promise<void> {
        try {
            await mkdir(this.usageDirectory, { recursive: true, mode: 0o700 });
            const at = Date.now();
            const month = new Date(at).toISOString().slice(0, 7);
            await appendFile(join(this.usageDirectory, `${month}.jsonl`), hostUsageLine({ at, ...usage }), { mode: 0o600 });
        } catch {
            console.warn(this.options.words.unloggedCall);
        }
    }

    /* The models a key may use, which throws a sentence for a key the API refuses. */
    protected abstract fetchModels(key: string): Promise<Model[]>;

    protected abstract catalogOf(models: Model[]): CatalogContent;

    /* What `models.json` holds, in the shape each provider has always written it. */
    protected abstract modelsFile(models: Model[]): unknown;

    protected abstract parseModelsFile(saved: unknown): Model[];

    private setModels(models: Model[]): void {
        this.models = models;
        this.catalog.replace({ updatedAt: new Date().toISOString(), ...this.catalogOf(models) });

        for (const listener of this.changeListeners) {
            listener();
        }
    }
}
