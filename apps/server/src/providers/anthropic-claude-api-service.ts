import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { isNotFound, Serializer, writeAtomic } from '@adecore/agents';
import { apiUsageLine } from '@adecore/agents/usage';
import { ModelCatalog } from '@adecore/agents/providers';
import { ClaudeApiSettingsSchema, DEFAULT_CLAUDE_API_SETTINGS, type ClaudeApiSettings, type ClaudeApiStatus } from '@ruimte/contracts';

// Deliberately not configurable: a key is sent to Anthropic and nowhere else, and a redirect is an error.
export const ANTHROPIC_URL = 'https://api.anthropic.com';
export const ANTHROPIC_VERSION = '2023-06-01';

export const ANTHROPIC_CLAUDE_API_DIR = 'anthropic-claude-api';
const CREDENTIAL_FILE = 'credential';
const MODELS_FILE = 'models.json';
const SETTINGS_FILE = 'settings.json';
const PAGE_SIZE = 1000;
// A catalog this long is not Anthropic's, so paging stops rather than follows a cursor that never ends.
const MAX_PAGES = 20;
const FALLBACK_CONTEXT = 200_000;

const ModelSchema = z.object({
    id: z.string().min(1).max(300),
    display_name: z.string().optional(),
    created_at: z.string().optional(),
    lifecycle: z.enum(['active', 'deprecated', 'retired']).optional(),
    line: z.string().nullish(),
    max_input_tokens: z.number().positive().nullish(),
    max_tokens: z.number().positive().nullish(),
    capabilities: z
        .object({ thinking: z.object({ types: z.object({ adaptive: z.object({ supported: z.boolean().optional() }).optional() }).optional() }).optional() })
        .nullish()
});
type AnthropicModel = z.infer<typeof ModelSchema>;

const PageSchema = z.object({
    data: z.array(ModelSchema),
    last_id: z.string().nullish(),
    has_more: z.boolean().optional()
});

export type AnthropicFetch = (url: string, init?: RequestInit) => Promise<Response>;

/* One call a chat made, with the counts as Anthropic reports them: the input apart from both cache kinds. */
export interface ClaudeApiCall {
    model: string;
    session: string;
    cwd: string;
    input: number;
    cacheRead: number;
    cacheWrite: number;
    output: number;
}

/*
 * What a request to Anthropic is sent with. The key is in the header and nowhere else, and redirects are
 * errors, so a key can never follow a `Location` to another host.
 */
export function anthropicHeaders(key: string): Record<string, string> {
    return { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' };
}

/*
 * A sentence for an HTTP status. A 400 carries Anthropic's own words, since "your credit balance is too low" is
 * the one a person needs, clipped; for every other status the sentence is fixed and nothing of the body is read.
 */
export function anthropicHttpError(status: number, message?: string): Error {
    if (status === 401) {
        return new Error('Anthropic rejected the API key.');
    }
    if (status === 403) {
        return new Error('Anthropic refused this request. The key may not be allowed to use this model.');
    }
    if (status === 404) {
        return new Error('Anthropic does not know this model. Refresh the models in Settings.');
    }
    if (status === 429) {
        return new Error('Anthropic rate limit reached. Wait before trying again.');
    }
    if (status === 529) {
        return new Error('Anthropic is overloaded. Try again in a moment.');
    }
    if (status === 400 && message !== undefined && message.trim() !== '') {
        return new Error(`Anthropic refused the request: ${message.trim().slice(0, 300)}`);
    }
    return new Error(`Anthropic request failed (HTTP ${status}).`);
}

/* The newest active model of the Sonnet line, which is the one most chats want, else the newest active one. */
export function defaultModelOf(models: AnthropicModel[]): string {
    const active = models.filter((model) => model.lifecycle !== 'deprecated');
    const newest = (list: AnthropicModel[]): AnthropicModel | undefined => [...list].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];
    return (newest(active.filter((model) => model.line === 'sonnet')) ?? newest(active) ?? models[0])?.id ?? '';
}

/*
 * The Claude API of this machine: its API key, the models it offers and how far a chat may go alone. They live in
 * `$RUIMTE_HOME/anthropic-claude-api`, the key in a 0600 file in a 0700 folder like the secrets of launches. No
 * client reads the folder (`MachineHome` keeps it closed) and no verb reaches it; the only reader is the chat
 * backend, which puts the key in the header of its own requests and nowhere else.
 */
export class AnthropicClaudeApiService {
    readonly catalog = new ModelCatalog({ defaultModel: '', profiles: {}, models: [] });
    readonly request: AnthropicFetch;
    private home: string | null = null;
    private key = '';
    private models: AnthropicModel[] = [];
    private settings: ClaudeApiSettings = DEFAULT_CLAUDE_API_SETTINGS;
    private readonly writes = new Serializer();

    constructor(request: AnthropicFetch = fetch) {
        this.request = request;
    }

    /* Where the key, the models and the conversations are, once `load` named the home. */
    get directory(): string {
        if (this.home === null) {
            throw new Error('The Claude API is not loaded on this machine.');
        }
        return join(this.home, ANTHROPIC_CLAUDE_API_DIR);
    }

    /* One log file a month of every call a chat made, which the usage page reads like a transcript. */
    get usageDirectory(): string {
        return join(this.directory, 'usage');
    }

    get apiKey(): string {
        return this.key;
    }

    status(): ClaudeApiStatus {
        return { configured: this.key !== '', models: this.models.length, settings: this.settings };
    }

    /* The cut of a run of tool rounds, as a person set it: without automatic continuing a chat gets one run. */
    runLimits(): { roundsPerRun: number; runs: number } {
        const { autoContinue, roundsPerRun, runs } = this.settings;
        return { roundsPerRun, runs: autoContinue ? runs : 1 };
    }

    /* The `max_tokens` of a request: what a person set, never more than the model allows. */
    maxOutputTokensFor(model: string): number {
        const allowed = this.models.find((entry) => entry.id === model)?.max_tokens;
        return allowed ? Math.min(this.settings.maxOutputTokens, allowed) : this.settings.maxOutputTokens;
    }

    /* Whether the model takes `thinking: { type: 'adaptive' }`, which is how the older ones are asked to think; the newer ones think without being asked. */
    supportsAdaptiveThinking(model: string): boolean {
        return this.models.find((entry) => entry.id === model)?.capabilities?.thinking?.types?.adaptive?.supported === true;
    }

    /* Keeps what a person changed, within what the wire allows, for the chats that start their next run after it. */
    setSettings(change: Partial<ClaudeApiSettings>): Promise<ClaudeApiStatus> {
        return this.writes.run(async () => {
            this.settings = ClaudeApiSettingsSchema.parse({ ...this.settings, ...change });
            await mkdir(this.directory, { recursive: true, mode: 0o700 });
            await writeAtomic(join(this.directory, SETTINGS_FILE), JSON.stringify(this.settings), 0o600);
            return this.status();
        });
    }

    /*
     * Never fails a turn: a call that was made counts whether or not its line could be written. Anthropic counts the
     * input apart from both cache kinds, which is how the log keeps them, so the counts go onto the line as they are.
     * Thinking is counted inside the output, so it has no count of its own.
     */
    async logUsage(call: ClaudeApiCall): Promise<void> {
        try {
            await mkdir(this.usageDirectory, { recursive: true, mode: 0o700 });
            const at = Date.now();
            const month = new Date(at).toISOString().slice(0, 7);
            const line = apiUsageLine({
                at,
                model: call.model,
                session: call.session,
                cwd: call.cwd,
                input: call.input,
                cacheRead: call.cacheRead,
                cacheWrite: call.cacheWrite,
                output: call.output,
                reasoning: 0
            });
            await appendFile(join(this.usageDirectory, `${month}.jsonl`), line, { mode: 0o600 });
        } catch {
            console.warn('A Claude API call could not be added to the usage log');
        }
    }

    async load(home: string): Promise<void> {
        this.home = home;
        this.key = '';
        this.settings = DEFAULT_CLAUDE_API_SETTINGS;
        this.setModels([]);
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        try {
            this.key = (await readFile(join(this.directory, CREDENTIAL_FILE), 'utf8')).trim();
        } catch (e) {
            if (!isNotFound(e)) {
                // Not the error itself: a parser or a path in it says nothing a person can act on here.
                console.warn('The Claude API key could not be read and counts as missing');
            }
        }
        try {
            const saved = ClaudeApiSettingsSchema.safeParse(JSON.parse(await readFile(join(this.directory, SETTINGS_FILE), 'utf8')));
            if (saved.success) {
                this.settings = saved.data;
            }
        } catch {
            // No settings yet, or ones this version cannot read: the defaults hold.
        }
        try {
            this.setModels(PageSchema.parse({ data: JSON.parse(await readFile(join(this.directory, MODELS_FILE), 'utf8')) }).data);
        } catch {
            // A missing or stale list is fetched again on the next save or refresh.
        }
    }

    /*
     * An empty key disconnects, a key replaces the saved one once Anthropic accepts it, and no key at all
     * fetches the models again with the saved one. The model list is how a key is checked: a wrong one is a 401.
     */
    configure(apiKey?: string): Promise<ClaudeApiStatus> {
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
                throw new Error('Enter an Anthropic API key.');
            }
            const models = await this.fetchModels(key);
            if (models.length === 0) {
                throw new Error('Anthropic returned no models for this key.');
            }
            await mkdir(this.directory, { recursive: true, mode: 0o700 });
            if (apiKey !== undefined) {
                await writeAtomic(join(this.directory, CREDENTIAL_FILE), key, 0o600, { durable: true });
                this.key = key;
            }
            await writeAtomic(join(this.directory, MODELS_FILE), JSON.stringify(models), 0o600);
            this.setModels(models);
            return this.status();
        });
    }

    /* Every page of the list, newest first as Anthropic sends it, without the models that are retired. */
    private async fetchModels(key: string): Promise<AnthropicModel[]> {
        const models: AnthropicModel[] = [];
        let after: string | null = null;
        for (let page = 0; page < MAX_PAGES; page++) {
            const query: string = `limit=${PAGE_SIZE}${after === null ? '' : `&after_id=${encodeURIComponent(after)}`}`;
            const response: Response = await this.request(`${ANTHROPIC_URL}/v1/models?${query}`, {
                headers: anthropicHeaders(key),
                redirect: 'error',
                signal: AbortSignal.timeout(20_000)
            });
            if (!response.ok) {
                throw anthropicHttpError(response.status);
            }
            const body = PageSchema.parse(await response.json());
            models.push(...body.data.filter((model) => model.lifecycle !== 'retired'));
            if (body.has_more !== true || !body.last_id) {
                break;
            }
            after = body.last_id;
        }
        return models;
    }

    private setModels(models: AnthropicModel[]): void {
        this.models = models;
        this.catalog.replace({
            updatedAt: new Date().toISOString(),
            defaultModel: defaultModelOf(models),
            profiles: Object.fromEntries(
                models.map((model) => {
                    const contextWindowTokens: Record<string, number> = { '*': model.max_input_tokens ?? FALLBACK_CONTEXT };
                    return [model.id, { options: [], contextWindowTokens }];
                })
            ),
            models: models.map((model) => ({
                slug: model.id,
                name: model.display_name ?? model.id,
                profile: model.id,
                ...(model.lifecycle === 'deprecated' ? { legacy: true } : {})
            }))
        });
    }
}
