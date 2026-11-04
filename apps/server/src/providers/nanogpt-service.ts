import type { ProbeResult } from '@adecore/agents/usage';
import { DEFAULT_NANOGPT_SETTINGS, NanoGptSettingsSchema, type NanoGptSettings } from '@ruimte/contracts';
import { z } from 'zod';
import { readNanoGptUsage } from '../usage/nanogpt-plan.ts';
import { KeyedApiService, type ApiFetch, type CatalogContent } from './keyed-api-service.ts';
import { nanoGptVendorOf } from './nanogpt-vendor.ts';

// Deliberately not configurable: neither a setting nor a redirect may route a chat to pay as you go.
export const NANOGPT_URL = 'https://nano-gpt.com/api/subscription/v1';

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

/* One call a chat made, with the counts as NanoGPT reports them. */
interface NanoGptCall {
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
        return new Error('NanoGPT reached a limit. Wait a moment and try again. You were not charged extra.');
    }

    if (status === 402 || status === 403) {
        return new Error('NanoGPT refused subscription access. Check your subscription and use a subscription API key.');
    }

    return new Error(`NanoGPT request failed (HTTP ${status}).`);
}

/* The NanoGPT subscription of this machine: its key and the models it includes. */
export class NanoGptService extends KeyedApiService<NanoGptSettings, NanoModel> {
    private readonly callListeners = new Set<() => void>();

    constructor(request: ApiFetch = fetch) {
        super(request, {
            folder: 'nanogpt',
            settingsSchema: NanoGptSettingsSchema,
            defaults: DEFAULT_NANOGPT_SETTINGS,
            words: {
                notLoaded: 'NanoGPT is not loaded on this machine.',
                enterKey: 'Enter a NanoGPT API key.',
                noModels: 'NanoGPT returned no models included in the subscription.',
                unreadableKey: 'The NanoGPT credential could not be read and counts as missing',
                unloggedCall: 'A NanoGPT call could not be added to the usage log'
            }
        });
    }

    /* Told after every call a chat made, for whatever should look at the quota it just spent. */
    onCall(listener: () => void): () => void {
        this.callListeners.add(listener);

        return () => this.callListeners.delete(listener);
    }

    /*
     * NanoGPT counts the OpenAI way, a prompt that holds its cached part and a completion that holds its reasoning. The
     * log keeps the kinds apart, so the cached part leaves the input here. NanoGPT has no cache write to report.
     */
    async logUsage(call: NanoGptCall): Promise<void> {
        const cacheRead = Math.min(call.prompt, call.cached);
        await this.appendUsage({
            model: call.model,
            session: call.session,
            cwd: call.cwd,
            input: call.prompt - cacheRead,
            cacheRead,
            cacheWrite: 0,
            output: call.completion,
            reasoning: call.reasoning
        });

        for (const listener of this.callListeners) {
            listener();
        }
    }

    /*
     * What is left of the subscription, for the usage page. A missing key says so in the page's words; a request that
     * fails throws, which the monitor reads as a failed read and keeps the last numbers for.
     */
    async readPlan(): Promise<ProbeResult> {
        if (this.apiKey === '') {
            return { unavailable: { reason: 'no-subscription', message: 'Add a NanoGPT API key in Settings.' } };
        }

        return readNanoGptUsage(await (await this.get('/usage', this.apiKey)).json());
    }

    supportsTools(model: string): boolean {
        return this.models.find((entry) => entry.id === model)?.capabilities?.tool_calling === true;
    }

    /*
     * The model list answers any key, so the usage of the subscription is what proves this one. A suffix on a slug
     * (`model:online`, `model:thinking`) can pick a route the subscription does not include and bill it, so only the
     * plain slugs are offered.
     */
    protected async fetchModels(key: string): Promise<NanoModel[]> {
        await this.get('/usage', key);
        const { data } = ModelsSchema.parse(await (await this.get('/models?detailed=true', key)).json());

        return data.filter((model) => !model.id.includes(':'));
    }

    protected catalogOf(models: NanoModel[]): CatalogContent {
        return {
            defaultModel: models.find((model) => model.capabilities?.tool_calling)?.id ?? models[0]?.id ?? '',
            profiles: Object.fromEntries(
                models.map((model) => [
                    model.id,
                    { options: [], contextWindowTokens: model.context_length ? { '*': model.context_length } : ({} as Record<string, number>) }
                ])
            ),
            models: models.map((model) => ({
                slug: model.id,
                name: model.name ?? model.id,
                profile: model.id,
                tools: model.capabilities?.tool_calling === true,
                vendor: nanoGptVendorOf(model.id)
            }))
        };
    }

    protected modelsFile(models: NanoModel[]): unknown {
        return { data: models };
    }

    protected parseModelsFile(saved: unknown): NanoModel[] {
        return ModelsSchema.parse(saved).data;
    }

    private async get(path: string, key: string): Promise<Response> {
        const response = await this.request(`${NANOGPT_URL}${path}`, {
            headers: { Authorization: `Bearer ${key}` },
            redirect: 'error',
            signal: AbortSignal.timeout(20_000)
        });

        if (!response.ok) {
            throw nanoHttpError(response.status);
        }

        return response;
    }
}
