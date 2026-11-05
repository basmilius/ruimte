import { createChatCompletionsBackend, type BackendHost, type BackendLaunch, type ChatBackend } from '@adecore/agents/chat';
import { createApiChatProvider } from '@adecore/agents/providers';
import { ruimteApiTools } from './ruimte-api-tools.ts';
import { NANOGPT_URL, NanoGptService, nanoHttpError } from './nanogpt-service.ts';

/* A chat on NanoGPT's subscription API, its thread kept beside the key as `<session id>.json`, with Ruimte's tools beside the project's. */
export function nanoGptBackend(service: NanoGptService): (launch: BackendLaunch, host: BackendHost) => ChatBackend {
    return createChatCompletionsBackend({
        name: 'NanoGPT',
        url: NANOGPT_URL,
        request: (url, init) => service.request(url, init),
        apiKey: () => service.apiKey,
        directory: () => service.directory,
        catalog: service.catalog,
        supportsTools: (model) => service.supportsTools(model),
        toolRounds: () => service.runLimits(),
        httpError: nanoHttpError,
        onUsage: (usage) => service.logUsage(usage),
        hostTools: (launch, host) => ruimteApiTools(launch, host),
        words: {
            noKey: 'Add a NanoGPT API key in Settings → Providers.',
            unknownModel: 'Refresh the NanoGPT subscription models in Settings.',
            disconnected: 'NanoGPT was disconnected in Settings.',
            failed: 'NanoGPT could not finish this turn. Check the connection and subscription settings.',
            approval: 'NanoGPT requests access to this project.'
        }
    });
}

/* One per daemon, so the places without a registry at hand (`providerFor`) see the same name and models as the registry. */
export const nanoGptService = new NanoGptService();
export const nanoGptProvider = createApiChatProvider({
    kind: 'nanogpt',
    name: 'NanoGPT',
    version: 'Subscription',
    service: nanoGptService,
    createBackend: nanoGptBackend(nanoGptService)
});
