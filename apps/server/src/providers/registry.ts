import type { AgentKind, ProviderInfo } from '@ruimte/contracts';
import type { CliDetection, ChatProvider } from '@adecore/agents/providers';
import { ProviderRegistry as AgentProviderRegistry, detectCli } from '@adecore/agents/providers';
import { createAppleProvider, appleProvider } from './apple-provider.ts';
import { claudeProvider } from './claude-provider.ts';
import { codexProvider } from './codex-provider.ts';
import { acpCatalogStore } from './acp-catalog-store.ts';
import {
    ANTIGRAVITY_CLI,
    antigravityOneShotArgs,
    copilotProvider,
    copilotUsageDirectory,
    createAntigravityProvider,
    createCopilotProvider,
    createGrokProvider,
    grokProvider
} from './acp-providers.ts';
import type { AcpServerLaunch } from './acp-server.ts';
import { nanoGptProvider } from './nanogpt-provider.ts';

// The CLIs the daemon ships with, in the order of `BUILT_IN_KINDS`. A new one is one more value there, here and in `builtInProviders`.
const BUILT_IN_PROVIDERS: ChatProvider[] = [claudeProvider, codexProvider, createAntigravityProvider(null), copilotProvider, grokProvider];

// As long as the base registry keeps whether a CLI is there.
const AGY_DETECTION_TTL_MS = 60_000;

// Offers nothing, so it answers a kind this version does not know with a provider that starts nothing.
const UNOFFERED = new AgentProviderRegistry({ providers: [] });

/* The provider of a kind, for the places that have no registry at hand (the hooks). */
export function providerFor(kind: AgentKind): ChatProvider {
    if (kind === 'apple') {
        return appleProvider;
    }
    if (kind === 'nanogpt') {
        return nanoGptProvider;
    }
    return BUILT_IN_PROVIDERS.find((provider) => provider.kind === kind) ?? UNOFFERED.get(kind);
}

interface ProviderRegistryOptions {
    providers?: ChatProvider[];
    appleEnabled?: () => boolean;
    // Where Antigravity's chat server is installed; without it Antigravity is a terminal only.
    antigravityServer?: AcpServerLaunch;
    // The executables to probe, when they are not the ones the providers name.
    commands?: Partial<Record<AgentKind, string>>;
    // How to probe; a test answers without spawning anything.
    detect?: (command: string) => Promise<CliDetection>;
    // Called on every `provider.list`, which is when a newer model catalog is worth asking for.
    onList?: () => void;
    // Where the ACP agents keep what they reported across a restart; absent keeps it in memory only.
    home?: string;
}

/* The providers of one registry; the ACP agents are made for it, so what one learns is kept in its home and reaches its listeners. */
function builtInProviders(options: ProviderRegistryOptions): ChatProvider[] {
    const store = (kind: AgentKind) => (options.home === undefined ? undefined : acpCatalogStore(options.home, kind));
    return [
        claudeProvider,
        codexProvider,
        createAntigravityProvider(options.antigravityServer ?? null, store('antigravity')),
        createCopilotProvider(store('copilot'), options.home === undefined ? undefined : copilotUsageDirectory(options.home)),
        createGrokProvider(store('grok')),
        createAppleProvider(options.appleEnabled ?? (() => false)),
        nanoGptProvider
    ];
}

/* What the daemon knows about each agent CLI: the chat CLIs, the ones it only starts in a terminal and the local model. */
export class ProviderRegistry extends AgentProviderRegistry {
    private readonly onList: (() => void) | null;
    private readonly probe: (command: string) => Promise<CliDetection>;
    private agyAt: { at: number; installed: boolean } | null = null;

    constructor(options: ProviderRegistryOptions = {}) {
        super({
            providers: options.providers ?? builtInProviders(options),
            // `agy`, never the server that stands in its place once installed: the server's state is its own status.
            commands: { antigravity: ANTIGRAVITY_CLI, ...options.commands },
            ...(options.detect ? { detect: options.detect } : {})
        });
        this.onList = options.onList ?? null;
        this.probe = options.detect ?? ((command) => detectCli(command));
    }

    override list(): Promise<ProviderInfo[]> {
        this.onList?.();
        return super.list();
    }

    /* The list as it stands, without the fetches a client's `provider.list` sets off. */
    current(): Promise<ProviderInfo[]> {
        return super.list();
    }

    /*
     * Antigravity answers a single prompt through `agy`, which is installed apart from the server its chats run on,
     * so it is asked by that executable; every other CLI goes the way the base registry picks it.
     */
    override async oneShotProvider(preferred?: AgentKind): Promise<ChatProvider | null> {
        if (preferred === 'antigravity' && (await this.agyInstalled())) {
            return this.agyOneShot();
        }
        const found = await super.oneShotProvider(preferred);
        if (found !== null) {
            return found;
        }
        return (await this.agyInstalled()) ? this.agyOneShot() : null;
    }

    private agyOneShot(): ChatProvider {
        return { ...this.get('antigravity'), command: [ANTIGRAVITY_CLI], oneShotArgs: antigravityOneShotArgs };
    }

    private async agyInstalled(): Promise<boolean> {
        if (!this.kinds().includes('antigravity')) {
            return false;
        }
        if (this.agyAt === null || Date.now() - this.agyAt.at >= AGY_DETECTION_TTL_MS) {
            const installed = (await this.probe(ANTIGRAVITY_CLI).catch(() => ({ installed: false }))).installed;
            this.agyAt = { at: Date.now(), installed };
        }
        return this.agyAt.installed;
    }

    protected override fallback(kind: AgentKind): ChatProvider {
        return providerFor(kind);
    }
}
