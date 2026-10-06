import { AppleBackend } from '../chat/apple-backend.ts';
import { appleSiliconMac, helperCommand, probeAppleHelper } from './apple-helper.ts';
import { ModelCatalog } from '@adecore/agents/providers/catalog';
import type { ChatProvider } from '@adecore/agents/providers/provider';

export function createAppleProvider(enabled: () => boolean = () => false): ChatProvider {
    return {
        kind: 'apple',
        name: 'Apple Foundation Models',
        command: [helperCommand()],
        resumeCommand: '',
        catalog: new ModelCatalog({
            defaultModel: 'apple-system',
            profiles: { local: { options: [], contextWindowTokens: {} } },
            models: [{ slug: 'apple-system', name: 'Apple on-device', profile: 'local', badge: 'Local' }]
        }),
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
            compaction: 'native',
            reportsCost: false,
            reportsContextWindow: false,
            reportsThinking: false,
            slashCommands: false
        },
        detect: async (command, env) => {
            if (!enabled()) {
                return { installed: false, version: 'Disabled in Settings' };
            }
            if (!appleSiliconMac()) {
                return { installed: false, version: 'Requires Apple silicon and macOS 26.4 or later' };
            }
            try {
                const { result, exited } = await probeAppleHelper(command, env);
                if (result.type !== 'availability' || exited !== 0) {
                    return {
                        installed: false,
                        version: result.type === 'startup.error' ? result.text : 'The Apple Foundation Models helper could not start'
                    };
                }
                return { installed: result.available, version: result.available ? 'On-device' : (result.reason ?? 'The local model is unavailable') };
            } catch {
                return { installed: false, version: 'Apple Foundation Models helper is missing or could not start' };
            }
        },
        enabled,
        firstPromptArgs: () => {
            throw new Error('Apple Foundation Models is only available as a chat.');
        },
        createBackend: (launch, host) => {
            if (!enabled()) {
                throw new Error('Enable Apple Foundation Models in Settings → Providers on this machine.');
            }
            return new AppleBackend(launch, host, undefined, { enabled });
        }
    };
}

export const appleProvider = createAppleProvider();
