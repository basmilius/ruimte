import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { isNotFound, Serializer, writeAtomic } from '@adecore/agents';
import { hostUsageLine, type ProbeResult } from '@adecore/agents/usage';
import { readNanoGptUsage } from '../usage/nanogpt-plan.ts';
import { ModelCatalog } from '@adecore/agents/providers';
import { DEFAULT_NANOGPT_SETTINGS, NanoGptSettingsSchema, type NanoGptSettings, type NanoGptStatus } from '@ruimte/contracts';
import { nanoGptVendorOf } from './nanogpt-vendor.ts';

// Deliberately not configurable: neither a setting nor a redirect may route a chat to pay as you go.
export const NANOGPT_URL = 'https://nano-gpt.com/api/subscription/v1';

export const NANOGPT_DIR = 'nanogpt';
const CREDENTIAL_FILE = 'credential';
const MODELS_FILE = 'models.json';
const SETTINGS_FILE = 'settings.json';

const ModelsSchema = z.object({
    data: z.array(
        z.object({
            id: z.string().min(1).max(300),
            name: z.string().optional(),
            context_length: z.number().positive().optional(),
            capabilities: z.object({ tool_calling: z.boolean().optional() }).optional()
        })
    )
});
type NanoModel = z.infer<typeof ModelsSchema>['data'][number];

export type NanoFetch = (url: string, init?: RequestInit) => Promise<Response>;

/* One call a chat made, with the counts as NanoGPT reports them. */
export interface NanoGptCall {
    model: string;
    session: string;
    cwd: string;
    prompt: number;
    cached: number;
    completion: number;
    reasoning: number;
}

/* A sentence for an HTTP status, never the body, which may quote the request and with it the key. */
export function nanoHttpError(status: number): Error {
    if (status === 401) {
        return new Error('NanoGPT rejected the API key.');
    }
    if (status === 429) {
        return new Error('NanoGPT subscription or rate limit reached. Wait before trying again; no pay as you go fallback was used.');
    }
    if (status === 402 || status === 403) {
        return new Error('NanoGPT refused subscription access. Check your subscription and use a subscription API key.');
    }
    return new Error(`NanoGPT request failed (HTTP ${status}).`);
}

/*
 * A suffix on a slug (`model:online`, `model:thinking`) can pick a route the subscription does not
 * include and bill it, so only the plain slugs the subscription lists are offered.
 */
export function subscriptionModels(models: NanoModel[]): NanoModel[] {
    return models.filter((model) => !model.id.includes(':'));
}

/*
 * The NanoGPT subscription of this machine: its API key and the models it includes. Both live in
 * `$RUIMTE_HOME/nanogpt`, the key in a 0600 file in a 0700 folder like the secrets of launches. No
 * client reads the folder (`MachineHome` keeps it closed) and no verb reaches it; the only reader is
 * the chat backend, which puts the key in the header of its own requests and nowhere else.
 */
export class NanoGptService {
    readonly catalog = new ModelCatalog({ defaultModel: '', profiles: {}, models: [] });
    readonly request: NanoFetch;
    private home: string | null = null;
    private key = '';
    private models: NanoModel[] = [];
    private settings: NanoGptSettings = DEFAULT_NANOGPT_SETTINGS;
    private readonly writes = new Serializer();
    private readonly callListeners = new Set<() => void>();
    private readonly changeListeners = new Set<() => void>();

    constructor(request: NanoFetch = fetch) {
        this.request = request;
    }

    /* Where the key, the models and the conversations are, once `load` named the home. */
    get directory(): string {
        if (this.home === null) {
            throw new Error('NanoGPT is not loaded on this machine.');
        }
        return join(this.home, NANOGPT_DIR);
    }

    /* One log file a month of every call a chat made, which the usage page reads like a transcript. */
    get usageDirectory(): string {
        return join(this.directory, 'usage');
    }

    get apiKey(): string {
        return this.key;
    }

    status(): NanoGptStatus {
        return { configured: this.key !== '', models: this.models.length, settings: this.settings };
    }

    /* The cut of a run of tool rounds, as a person set it: without automatic continuing a chat gets one run. */
    runLimits(): { roundsPerRun: number; runs: number } {
        const { autoContinue, roundsPerRun, runs } = this.settings;
        return { roundsPerRun, runs: autoContinue ? runs : 1 };
    }

    /* Keeps what a person changed, within what the wire allows, for the chats that start their next run after it. */
    setSettings(change: Partial<NanoGptSettings>): Promise<NanoGptStatus> {
        return this.writes.run(async () => {
            this.settings = NanoGptSettingsSchema.parse({ ...this.settings, ...change });
            await mkdir(this.directory, { recursive: true, mode: 0o700 });
            await writeAtomic(join(this.directory, SETTINGS_FILE), JSON.stringify(this.settings), 0o600);
            return this.status();
        });
    }

    /* Told after every call a chat made, for whatever should look at the quota it just spent. */
    onCall(listener: () => void): () => void {
        this.callListeners.add(listener);
        return () => this.callListeners.delete(listener);
    }

    /* Told when the key or the models changed, so the provider list goes out again. */
    onChange(listener: () => void): () => void {
        this.changeListeners.add(listener);
        return () => this.changeListeners.delete(listener);
    }

    /*
     * Never fails a turn: a call that was made counts whether or not its line could be written. NanoGPT counts the
     * OpenAI way, a prompt that holds its cached part and a completion that holds its reasoning, and the log keeps
     * the kinds apart, so the cached part leaves the input here. NanoGPT has no cache write to report.
     */
    async logUsage(call: NanoGptCall): Promise<void> {
        try {
            await mkdir(this.usageDirectory, { recursive: true, mode: 0o700 });
            const at = Date.now();
            const month = new Date(at).toISOString().slice(0, 7);
            const cacheRead = Math.min(call.prompt, call.cached);
            const line = hostUsageLine({
                at,
                model: call.model,
                session: call.session,
                cwd: call.cwd,
                input: call.prompt - cacheRead,
                cacheRead,
                cacheWrite: 0,
                output: call.completion,
                reasoning: call.reasoning
            });
            await appendFile(join(this.usageDirectory, `${month}.jsonl`), line, { mode: 0o600 });
        } catch {
            console.warn('A NanoGPT call could not be added to the usage log');
        }
        for (const listener of this.callListeners) {
            listener();
        }
    }

    /*
     * What is left of the subscription, read with the key this machine holds, for the usage page. A key that
     * is missing says so in the page's words, and a request that fails throws, which the monitor reads as a
     * failed read and keeps the last numbers for.
     */
    async readPlan(): Promise<ProbeResult> {
        if (this.key === '') {
            return { unavailable: { reason: 'no-subscription', message: 'Add a NanoGPT API key in Settings.' } };
        }
        const response = await this.request(`${NANOGPT_URL}/usage`, {
            headers: { Authorization: `Bearer ${this.key}` },
            redirect: 'error',
            signal: AbortSignal.timeout(20_000)
        });
        if (!response.ok) {
            throw nanoHttpError(response.status);
        }
        return readNanoGptUsage(await response.json());
    }

    supportsTools(model: string): boolean {
        return this.models.find((entry) => entry.id === model)?.capabilities?.tool_calling === true;
    }

    async load(home: string): Promise<void> {
        this.home = home;
        this.key = '';
        this.settings = DEFAULT_NANOGPT_SETTINGS;
        this.setModels([]);
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        try {
            this.key = (await readFile(join(this.directory, CREDENTIAL_FILE), 'utf8')).trim();
        } catch (e) {
            if (!isNotFound(e)) {
                // Not the error itself: a parser or a path in it says nothing a person can act on here.
                console.warn('The NanoGPT credential could not be read and counts as missing');
            }
        }
        try {
            const saved = NanoGptSettingsSchema.safeParse(JSON.parse(await readFile(join(this.directory, SETTINGS_FILE), 'utf8')));
            if (saved.success) {
                this.settings = saved.data;
            }
        } catch {
            // No settings yet, or ones this version cannot read: the defaults hold.
        }
        try {
            this.setModels(ModelsSchema.parse(JSON.parse(await readFile(join(this.directory, MODELS_FILE), 'utf8'))).data);
        } catch {
            // A missing or stale list is fetched again on the next save or refresh.
        }
    }

    /*
     * An empty key disconnects, a key replaces the saved one once NanoGPT accepts it, and no key at
     * all fetches the models again with the saved one.
     */
    configure(apiKey?: string): Promise<NanoGptStatus> {
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
                throw new Error('Enter a NanoGPT API key.');
            }
            const get = async (path: string): Promise<Response> => {
                const response = await this.request(`${NANOGPT_URL}${path}`, {
                    headers: { Authorization: `Bearer ${key}` },
                    redirect: 'error',
                    signal: AbortSignal.timeout(20_000)
                });
                if (!response.ok) {
                    throw nanoHttpError(response.status);
                }
                return response;
            };
            // The model list answers any key, so the usage of the subscription is what proves this one.
            await get('/usage');
            const models = subscriptionModels(ModelsSchema.parse(await (await get('/models?detailed=true')).json()).data);
            if (models.length === 0) {
                throw new Error('NanoGPT returned no models included in the subscription.');
            }
            await mkdir(this.directory, { recursive: true, mode: 0o700 });
            if (apiKey !== undefined) {
                await writeAtomic(join(this.directory, CREDENTIAL_FILE), key, 0o600, { durable: true });
                this.key = key;
            }
            await writeAtomic(join(this.directory, MODELS_FILE), JSON.stringify({ data: models }), 0o600);
            this.setModels(models);
            return this.status();
        });
    }

    private setModels(models: NanoModel[]): void {
        this.models = models;
        this.catalog.replace({
            updatedAt: new Date().toISOString(),
            defaultModel: models.find((model) => model.capabilities?.tool_calling)?.id ?? models[0]?.id ?? '',
            profiles: Object.fromEntries(
                models.map((model) => {
                    const contextWindowTokens: Record<string, number> = model.context_length ? { '*': model.context_length } : {};
                    return [model.id, { options: [], contextWindowTokens }];
                })
            ),
            models: models.map((model) => ({
                slug: model.id,
                name: model.name ?? model.id,
                profile: model.id,
                tools: model.capabilities?.tool_calling === true,
                vendor: nanoGptVendorOf(model.id)
            }))
        });
        for (const listener of this.changeListeners) {
            listener();
        }
    }
}
