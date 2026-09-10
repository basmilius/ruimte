import type { AgentKind, ProviderInfo } from '@ruimte/contracts';
import type { ModelCatalog } from './catalog.ts';
import { claudeProvider } from './claude-provider.ts';
import { codexProvider } from './codex-provider.ts';
import type { CliDetection } from './detect.ts';
import type { ChatProvider } from './provider.ts';
import { copilotProvider, geminiProvider } from './terminal-providers.ts';

// How long a "is it installed" answer stays good; an install mid-session shows up on the next check.
const DETECTION_TTL_MS = 60_000;

// The CLIs the daemon ships with, in the order every menu lists them. A new one is one more value here.
const BUILT_IN_PROVIDERS: ChatProvider[] = [claudeProvider, codexProvider, geminiProvider, copilotProvider];

/* The provider of a kind, for the places that have no registry at hand (the hooks). */
export const providerFor = (kind: AgentKind): ChatProvider => BUILT_IN_PROVIDERS.find((provider) => provider.kind === kind) ?? claudeProvider;

interface ProviderRegistryOptions {
    providers?: ChatProvider[];
    // The executables to probe, when they are not the ones the providers name.
    commands?: Partial<Record<AgentKind, string>>;
    // How to probe; a test answers without spawning anything.
    detect?: (command: string) => Promise<CliDetection>;
}

/* What the daemon knows about each agent CLI: whether it is there, what it offers and what it can do. */
export class ProviderRegistry {
    private readonly providers: ChatProvider[];
    private readonly commands: Partial<Record<AgentKind, string>>;
    private readonly detect: ((command: string) => Promise<CliDetection>) | null;
    private readonly cache = new Map<AgentKind, { at: number; detection: CliDetection }>();

    constructor(options: ProviderRegistryOptions = {}) {
        this.providers = options.providers ?? BUILT_IN_PROVIDERS;
        this.commands = options.commands ?? {};
        this.detect = options.detect ?? null;
    }

    async list(): Promise<ProviderInfo[]> {
        return await Promise.all(
            this.providers.map(async (provider) => ({
                kind: provider.kind,
                name: provider.name,
                ...(await this.detection(provider)),
                models: provider.catalog.list(),
                defaultModel: provider.catalog.defaultModel || null,
                capabilities: provider.capabilities,
                resumeCommand: provider.resumeCommand
            }))
        );
    }

    get(kind: AgentKind): ChatProvider {
        return this.providers.find((provider) => provider.kind === kind) ?? providerFor(kind);
    }

    catalogFor(kind: AgentKind): ModelCatalog {
        return this.get(kind).catalog;
    }

    private async detection(provider: ChatProvider): Promise<CliDetection> {
        const cached = this.cache.get(provider.kind);
        if (cached && Date.now() - cached.at < DETECTION_TTL_MS) {
            return cached.detection;
        }
        const command = this.commands[provider.kind] ?? provider.command[0]!;
        const detection = this.detect ? await this.detect(command) : await provider.detect(command, process.env);
        this.cache.set(provider.kind, { at: Date.now(), detection });
        return detection;
    }
}
