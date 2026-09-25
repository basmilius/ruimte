import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AppleFoundationEventSchema } from '@ruimte/contracts';
import { AppleBackend } from '../chat/apple-backend.ts';
import { ModelCatalog } from './catalog.ts';
import type { ChatProvider } from './provider.ts';

const helperCommand = (): string => {
    if (process.env.RUIMTE_APPLE_FOUNDATION_HELPER) {
        return process.env.RUIMTE_APPLE_FOUNDATION_HELPER;
    }
    const packaged = join(dirname(process.execPath), 'native', 'ruimte-foundation-models');
    if (existsSync(packaged)) {
        return packaged;
    }
    const built = fileURLToPath(new URL('../../../foundation-models/dist/ruimte-foundation-models', import.meta.url));
    return existsSync(built) ? built : fileURLToPath(new URL('../../../foundation-models/.build/debug/ruimte-foundation-models', import.meta.url));
};

export const createAppleProvider = (enabled: () => boolean = () => false): ChatProvider => ({
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
        if (process.platform !== 'darwin' || process.arch !== 'arm64') {
            return { installed: false, version: 'Requires Apple silicon and macOS 26.4 or later' };
        }
        try {
            const child = Bun.spawn([command, '--probe'], { env, stdout: 'pipe', stderr: 'ignore' });
            const timer = setTimeout(() => child.kill(), 10_000);
            try {
                const result = AppleFoundationEventSchema.parse(JSON.parse(await new Response(child.stdout).text()));
                const exited = await child.exited;
                if (result.type !== 'availability' || exited !== 0) {
                    return { installed: false, version: result.type === 'startup.error' ? result.text : 'The Apple Foundation Models helper could not start' };
                }
                return { installed: result.available, version: result.available ? 'On-device' : (result.reason ?? 'The local model is unavailable') };
            } finally {
                clearTimeout(timer);
            }
        } catch {
            return { installed: false, version: 'Apple Foundation Models helper is missing or could not start' };
        }
    },
    firstPromptArgs: () => {
        throw new Error('Apple Foundation Models is only available as a chat.');
    },
    createBackend: (launch, host) => {
        if (!enabled()) {
            throw new Error('Enable Apple Foundation Models in Settings → Providers on this machine.');
        }
        return new AppleBackend(launch, host, undefined, { enabled });
    }
});

export const appleProvider = createAppleProvider();
