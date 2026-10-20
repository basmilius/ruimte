import type { ChatProvider } from '@adecore/agents/providers';
import { AnthropicClaudeApiBackend } from '../chat/anthropic-claude-api-backend.ts';
import { AnthropicClaudeApiService } from './anthropic-claude-api-service.ts';

/*
 * The API of Claude as a chat. There is no CLI: the daemon talks to the API itself, so the provider is there
 * once a person saved a key in Settings and Anthropic listed the models it offers.
 */
export function createAnthropicClaudeApiProvider(service: AnthropicClaudeApiService): ChatProvider {
    return {
        kind: 'anthropic-claude-api',
        name: 'Claude API',
        command: ['anthropic-claude-api'],
        resumeCommand: '',
        catalog: service.catalog,
        ignoresProjectConfig: true,
        capabilities: {
            chat: true,
            terminal: false,
            hooks: false,
            streamsToolOutput: false,
            diffs: 'unified',
            attachments: false,
            mentions: false,
            denyReason: true,
            allowAlways: false,
            asyncQuestions: false,
            compaction: 'none',
            reportsCost: false,
            reportsContextWindow: true,
            reportsThinking: true,
            slashCommands: false
        },
        // The list draws the version beside the name, so a provider that is not set up yet shows none.
        detect: async () => {
            const { configured, models } = service.status();
            const ready = configured && models > 0;
            return { installed: ready, version: ready ? 'API key' : null };
        },
        firstPromptArgs: () => {
            throw new Error('The Claude API is only available as a chat.');
        },
        createBackend: (launch, host) => new AnthropicClaudeApiBackend(launch, host, service)
    };
}

/*
 * One per daemon, like the NanoGPT provider, so the places without a registry at hand (`providerFor`) see
 * the same name and the same models as the registry. The daemon loads it from its home at boot.
 */
export const anthropicClaudeApiService = new AnthropicClaudeApiService();
export const anthropicClaudeApiProvider = createAnthropicClaudeApiProvider(anthropicClaudeApiService);
