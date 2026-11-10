import { createChatCompletionsBackend, type BackendHost, type BackendLaunch, type ChatBackend } from '@adecore/agents/chat';
import { createApiChatProvider, type ChatProvider } from '@adecore/agents/providers';
import { withRuimteMcp } from '../ruimte-mcp.ts';
import { NANOGPT_URL, nanoHttpError, type NanoGptService } from './nanogpt-service.ts';
import { ruimteApiTools } from './ruimte-api-tools.ts';

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

export function createNanoGptProvider(service: NanoGptService): ChatProvider {
    return createApiChatProvider({
        kind: 'nanogpt',
        name: 'NanoGPT',
        version: 'Subscription',
        service,
        launch: withRuimteMcp,
        createBackend: nanoGptBackend(service)
    });
}
