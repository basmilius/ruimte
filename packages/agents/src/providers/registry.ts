import type { AgentKind, ProviderCapabilities, ProviderInfo } from '@ruimte/agent-contracts';
import { ModelCatalog } from './catalog.ts';
import { claudeProvider } from './claude-provider.ts';
import { codexProvider } from './codex-provider.ts';
import type { CliDetection } from './detect.ts';
import type { ChatProvider } from './provider.ts';

// How long a "is it installed" answer stays good; an install mid-session shows up on the next check.
const DETECTION_TTL_MS = 60_000;

const DISABLED: CliDetection = { installed: false, version: 'Disabled in Settings' };

const NO_CAPABILITIES: ProviderCapabilities = {
    chat: false,
    terminal: false,
    hooks: false,
    streamsToolOutput: false,
    diffs: 'none',
    attachments: false,
    mentions: false,
    denyReason: false,
    allowAlways: false,
    asyncQuestions: false,
    compaction: 'none',
    reportsCost: false,
    reportsContextWindow: false,
    reportsThinking: false,
    slashCommands: false
};

/* A CLI of a kind the host does not offer: a record or an account may still name one, and it starts nothing. */
export const unofferedProvider = (kind: AgentKind): ChatProvider => ({
    kind,
    name: kind,
    catalog: new ModelCatalog({ defaultModel: '', profiles: {}, models: [] }),
    capabilities: NO_CAPABILITIES,
    command: [kind],
    resumeCommand: '',
    detect: () => Promise.resolve({ installed: false, version: null }),
    firstPromptArgs: () => {
        throw new Error(`${kind} is not offered here`);
    },
    createBackend: () => {
        throw new Error(`${kind} is not offered here`);
    }
});

const BUILT_IN_PROVIDERS: readonly ChatProvider[] = [claudeProvider, codexProvider];

/* The provider of a kind, for the places that have no registry at hand. */
export const providerFor = (kind: AgentKind): ChatProvider => BUILT_IN_PROVIDERS.find((provider) => provider.kind === kind) ?? unofferedProvider(kind);

export interface ProviderRegistryOptions {
    // The CLIs a host offers, in the order every menu lists them; absent, the chat CLIs this package ships.
    providers?: ChatProvider[];
    // The executables to probe, when they are not the ones the providers name.
    commands?: Partial<Record<AgentKind, string>>;
    // How to probe; a test answers without spawning anything.
    detect?: (command: string) => Promise<CliDetection>;
    // The environment a probe runs in.
    env?: Record<string, string | undefined>;
}

/* What a host knows about each agent CLI: whether it is there, what it offers and what it can do. */
export class ProviderRegistry {
    private readonly providers: ChatProvider[];
    private readonly commands: Partial<Record<AgentKind, string>>;
    private readonly detect: ((command: string) => Promise<CliDetection>) | null;
    private readonly env: Record<string, string | undefined>;
    private readonly cache = new Map<AgentKind, { at: number; detection: CliDetection }>();

    constructor(options: ProviderRegistryOptions = {}) {
        this.providers = options.providers ?? [...BUILT_IN_PROVIDERS];
        this.commands = options.commands ?? {};
        this.detect = options.detect ?? null;
        this.env = options.env ?? process.env;
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

    /* The provider of a kind, one this host does not offer included. */
    get(kind: AgentKind): ChatProvider {
        return this.providers.find((provider) => provider.kind === kind) ?? this.fallback(kind);
    }

    /*
     * The CLI that answers a single prompt here: the one asked for when it is installed, else the
     * first installed provider that can, in the order the catalog lists them. Null on a machine
     * with none, which is what hides the button that would ask.
     */
    async oneShotProvider(preferred?: AgentKind): Promise<ChatProvider | null> {
        const order = preferred ? [this.get(preferred), ...this.providers] : this.providers;
        for (const provider of order) {
            if (provider.oneShotArgs && (await this.detection(provider)).installed) {
                return provider;
            }
        }
        return null;
    }

    catalogFor(kind: AgentKind): ModelCatalog {
        return this.get(kind).catalog;
    }

    enabled(kind: AgentKind): boolean {
        return this.get(kind).enabled?.() !== false;
    }

    invalidate(kind: AgentKind): void {
        this.cache.delete(kind);
    }

    protected fallback(kind: AgentKind): ChatProvider {
        return unofferedProvider(kind);
    }

    private async detection(provider: ChatProvider): Promise<CliDetection> {
        if (provider.enabled?.() === false) {
            return DISABLED;
        }
        const cached = this.cache.get(provider.kind);
        if (cached && Date.now() - cached.at < DETECTION_TTL_MS) {
            return cached.detection;
        }
        const command = this.commands[provider.kind] ?? provider.command[0]!;
        const detection = this.detect ? await this.detect(command) : await provider.detect(command, this.env);
        // Turned off while the probe ran.
        if (provider.enabled?.() === false) {
            return DISABLED;
        }
        this.cache.set(provider.kind, { at: Date.now(), detection });
        return detection;
    }
}
