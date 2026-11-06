import type { Area } from '../area.ts';
import type { AnthropicClaudeApiService } from '../providers/anthropic-claude-api-service.ts';
import type { NanoGptService } from '../providers/nanogpt-service.ts';

export interface ProviderKeysDeps {
    nanogpt: NanoGptService;
    claudeApi: AnthropicClaudeApiService;
}

/* The providers a person gives a key of their own. A key bills a person's subscription, so only the owner of the machine sets or removes one. */
export function providerKeysArea({ nanogpt, claudeApi }: ProviderKeysDeps): Area {
    return {
        name: 'provider keys',
        handlers: (dispatcher) => {
            dispatcher.register('nanogpt.status', () => nanogpt.status());
            dispatcher.register(
                'nanogpt.configure',
                async ({ apiKey, settings }) => {
                    if (settings !== undefined) {
                        const saved = await nanogpt.setSettings(settings);
                        // Only settings changed: the key and the models stay as they are.
                        if (apiKey === undefined) {
                            return saved;
                        }
                    }
                    return await nanogpt.configure(apiKey);
                },
                { owner: true }
            );
            dispatcher.register('anthropic.status', () => claudeApi.status());
            dispatcher.register('anthropic.configure', (payload) => claudeApi.apply(payload), { owner: true });
        }
    };
}
