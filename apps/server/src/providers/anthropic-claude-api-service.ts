import {
    ClaudeApiSettingsSchema,
    DEFAULT_CLAUDE_API_SETTINGS,
    type ClaudeApiConfigurePayload,
    type ClaudeApiSettings,
    type ClaudeApiStatus,
    type ModelInfo
} from '@ruimte/contracts';
import { HOME_FOLDERS } from '@ruimte/service/home';
import { z } from 'zod';
import { KeyedApiService, type ApiFetch, type CatalogContent } from './keyed-api-service.ts';

// Deliberately not configurable: a key is sent to Anthropic and nowhere else, and a redirect is an error.
export const ANTHROPIC_URL = 'https://api.anthropic.com';
export const ANTHROPIC_VERSION = '2023-06-01';

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

type ModelOption = ModelInfo['options'][number];
type CatalogProfile = CatalogContent['profiles'][string];

/* What Claude Code's own catalog knows of a model, read through what a catalog answers in public. */
interface ClaudeModels {
    list(): ModelInfo[];
    resolveModel(name: string): string | null;
    contextWindowFor(selection: { model: string; options: Record<string, string | boolean> }): number | null;
}

// The levels every model that thinks on request takes on the CLI's flag, for one Claude Code's catalog does not know yet.
const PLAIN_EFFORT: ModelOption = {
    id: 'effort',
    label: 'Reasoning',
    type: 'select',
    defaultChoice: 'high',
    choices: [
        { id: 'low', label: 'Low' },
        { id: 'medium', label: 'Medium' },
        { id: 'high', label: 'High' }
    ]
};

/*
 * The options of the same model in Claude Code's catalog, which runs these chats too, with the window of each pick. A model
 * it does not know gets effort when the API says it thinks on request, and its own window.
 */
function profileOf(model: AnthropicModel, claude: ClaudeModels | null, contextWindow: string): CatalogProfile {
    const slug = claude?.resolveModel(model.id) ?? null;
    const known = slug === null ? undefined : claude?.list().find((entry) => entry.slug === slug);

    if (claude === null || slug === null || known === undefined) {
        const adaptive = model.capabilities?.thinking?.types?.adaptive?.supported === true;

        return { options: adaptive ? [PLAIN_EFFORT] : [], contextWindowTokens: { '*': model.max_input_tokens ?? FALLBACK_CONTEXT } };
    }

    const windows = known.options.find((option) => option.id === 'contextWindow');
    const contextWindowTokens: Record<string, number> = {
        '*': claude.contextWindowFor({ model: slug, options: {} }) ?? model.max_input_tokens ?? FALLBACK_CONTEXT
    };

    for (const choice of windows?.type === 'select' ? windows.choices : []) {
        const tokens = claude.contextWindowFor({ model: slug, options: { contextWindow: choice.id } });

        if (tokens !== null) {
            contextWindowTokens[choice.id] = tokens;
        }
    }

    return { options: known.options.map((option) => withWindowDefault(option, contextWindow)), contextWindowTokens };
}

/* The window a person chose for new chats as the default, on a model that offers both. */
function withWindowDefault(option: ModelOption, contextWindow: string): ModelOption {
    if (option.id !== 'contextWindow' || option.type !== 'select' || !['200k', '1m'].every((id) => option.choices.some((choice) => choice.id === id))) {
        return option;
    }

    return { ...option, defaultChoice: contextWindow };
}

const PageSchema = z.object({
    data: z.array(ModelSchema),
    last_id: z.string().nullish(),
    has_more: z.boolean().optional()
});

/* The key goes in the header and nowhere else; with redirects as errors it never follows a `Location` to another host. */
function anthropicHeaders(key: string): Record<string, string> {
    return { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' };
}

/*
 * A sentence for an HTTP status. A 400 carries Anthropic's own words, clipped, since "your credit balance is too low" is
 * the one a person needs; every other status gets a fixed sentence and its body is never read.
 */
export function anthropicHttpError(status: number, message?: string): Error {
    switch (status) {
        case 401:
            return new Error('Anthropic rejected the API key.');
        case 403:
            return new Error('Anthropic refused this request. The key may not be allowed to use this model.');
        case 404:
            return new Error('Anthropic does not know this model. Refresh the models in Settings.');
        case 429:
            return new Error('Anthropic rate limit reached. Wait before trying again.');
        case 529:
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
    const newest = (list: AnthropicModel[]): AnthropicModel | undefined => list.toSorted((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];

    return (newest(active.filter((model) => model.line === 'sonnet')) ?? newest(active) ?? models[0])?.id ?? '';
}

/* The Claude API of this machine: its key, the models it offers and how far a chat may go alone. */
export class AnthropicClaudeApiService extends KeyedApiService<ClaudeApiSettings, AnthropicModel> {
    private readonly claude: ClaudeModels | null;

    /* `claude` is Claude Code's catalog, whose options these chats take, since they run in Claude Code too. */
    constructor(request: ApiFetch = fetch, claude: ClaudeModels | null = null) {
        super(request, {
            folder: HOME_FOLDERS.anthropicClaudeApi,
            settingsSchema: ClaudeApiSettingsSchema,
            defaults: DEFAULT_CLAUDE_API_SETTINGS,
            words: {
                notLoaded: 'The Claude API is not loaded on this machine.',
                enterKey: 'Enter an Anthropic API key.',
                noModels: 'Anthropic returned no models for this key.',
                unreadableKey: 'The Claude API key could not be read and counts as missing',
                unloggedCall: 'A Claude API call could not be added to the usage log'
            }
        });
        this.claude = claude;
    }

    /* A new default window changes the models' options, so the catalog and the provider list go out again; a chat keeps its pick. */
    override async setSettings(change: Partial<ClaudeApiSettings>): ReturnType<KeyedApiService<ClaudeApiSettings, AnthropicModel>['setSettings']> {
        const before = this.settings.contextWindow;
        const status = await super.setSettings(change);

        if (this.settings.contextWindow !== before) {
            this.rebuildCatalog();
        }

        return status;
    }

    /* The most a reply of the model may use: what a person set, never more than the model allows. */
    maxOutputTokensFor(model: string): number {
        const allowed = this.models.find((entry) => entry.id === model)?.max_tokens;

        return allowed ? Math.min(this.settings.maxOutputTokens, allowed) : this.settings.maxOutputTokens;
    }

    /* What `anthropic.configure` asks. The key is checked before the settings sent along are kept, so a rejected key changes nothing. */
    async apply({ apiKey, settings }: ClaudeApiConfigurePayload): Promise<ClaudeApiStatus> {
        if (settings === undefined) {
            return await this.configure(apiKey);
        }

        if (apiKey !== undefined) {
            await this.configure(apiKey);
        }

        return await this.setSettings(settings);
    }

    /* Every page of the list, newest first as Anthropic sends it, without the retired models. A wrong key is a 401. */
    protected async fetchModels(key: string): Promise<AnthropicModel[]> {
        const models: AnthropicModel[] = [];
        let after: string | null = null;

        for (let page = 0; page < MAX_PAGES; page++) {
            const query = `limit=${PAGE_SIZE}${after === null ? '' : `&after_id=${encodeURIComponent(after)}`}`;
            const response = await this.request(`${ANTHROPIC_URL}/v1/models?${query}`, {
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

    protected catalogOf(models: AnthropicModel[]): CatalogContent {
        return {
            defaultModel: defaultModelOf(models),
            profiles: Object.fromEntries(models.map((model) => [model.id, profileOf(model, this.claude, this.settings.contextWindow ?? '200k')])),
            models: models.map((model) => ({
                slug: model.id,
                name: model.display_name ?? model.id,
                profile: model.id,
                ...(model.lifecycle === 'deprecated' ? { legacy: true } : {})
            }))
        };
    }

    protected modelsFile(models: AnthropicModel[]): unknown {
        return models;
    }

    protected parseModelsFile(saved: unknown): AnthropicModel[] {
        return z.array(ModelSchema).parse(saved);
    }
}
