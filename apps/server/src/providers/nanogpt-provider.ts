import type { ChatProvider } from '@adecore/agents/providers';
import { NanoGptBackend } from '../chat/nanogpt-backend.ts';
import { NanoGptService } from './nanogpt-service.ts';

/*
 * NanoGPT's subscription API as a chat. There is no CLI: the daemon talks to the API itself, so the
 * provider is there once a person saved a key in Settings and NanoGPT listed the models it includes.
 */
export function createNanoGptProvider(service: NanoGptService): ChatProvider {
    return {
        kind: 'nanogpt',
        name: 'NanoGPT Subscription',
        command: ['nanogpt'],
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
            return { installed: ready, version: ready ? 'Subscription' : null };
        },
        firstPromptArgs: () => {
            throw new Error('NanoGPT is only available as a chat.');
        },
        createBackend: (launch, host) => new NanoGptBackend(launch, host, service)
    };
}

/*
 * One per daemon, like the Apple provider, so the places without a registry at hand (`providerFor`)
 * see the same name and the same models as the registry. The daemon loads it from its home at boot.
 */
export const nanoGptService = new NanoGptService();
export const nanoGptProvider = createNanoGptProvider(nanoGptService);
