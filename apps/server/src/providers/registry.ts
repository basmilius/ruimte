import { ProviderRegistry as AgentProviderRegistry, type AcpServerLaunch, type ChatProvider, type CliDetection } from '@adecore/agents/providers';
import { pickerGroupsOf, type AgentKind, type ProviderInfo } from '@ruimte/contracts';
import type { AcpServerInstall, AcpServerRelease } from './acp-server.ts';
import type { AnthropicClaudeApiService } from './anthropic-claude-api-service.ts';
import type { NanoGptService } from './nanogpt-service.ts';
import { createProviders, type ProviderCommands } from './table.ts';

interface ProviderRegistryOptions {
    providers?: ChatProvider[];
    // Stands in for the chat server a person installed apart from a CLI, as a test's.
    serverLaunches?: Partial<Record<AgentKind, AcpServerLaunch>>;
    // How to probe; a test answers without spawning anything.
    detect?: (command: string) => Promise<CliDetection>;
    // Called on every `provider.list`, which is when a newer model catalog is worth asking for.
    onList?: () => void;
    // Where the ACP agents keep what they reported across a restart; absent keeps it in memory only.
    home?: string;
    // What starts Claude Code and Codex when it is not the one on the path, and how Codex's help is read: a test's fakes.
    commands?: ProviderCommands;
}

/* What the daemon knows about each agent CLI: the chat CLIs, the ones it only starts in a terminal and the API providers. */
export class ProviderRegistry extends AgentProviderRegistry {
    // The services behind the API providers, which keep a key and its models in the daemon's home.
    readonly nanogpt: NanoGptService;
    readonly claudeApi: AnthropicClaudeApiService;
    // The chat servers a person installs apart from their CLI, which exist once the registry has a home to install into.
    readonly servers: ReadonlyMap<AgentKind, { install: AcpServerInstall; release: AcpServerRelease }>;
    private readonly onList: (() => void) | null;

    constructor(options: ProviderRegistryOptions = {}) {
        const table = createProviders({
            ...(options.home === undefined ? {} : { home: options.home }),
            ...(options.serverLaunches === undefined ? {} : { serverLaunches: options.serverLaunches }),
            ...(options.commands === undefined ? {} : { commands: options.commands })
        });

        super({ providers: options.providers ?? table.providers, ...(options.detect ? { detect: options.detect } : {}) });
        this.nanogpt = table.nanogpt;
        this.claudeApi = table.claudeApi;
        this.servers = table.servers;
        this.onList = options.onList ?? null;
    }

    override list(): Promise<ProviderInfo[]> {
        this.onList?.();

        return this.current();
    }

    /* The list as it stands, without the fetches a client's `provider.list` sets off, in the order a picker shows it. */
    async current(): Promise<ProviderInfo[]> {
        const groups = pickerGroupsOf(await super.list());

        return [...groups.frontier, ...groups.others, ...groups.api];
    }
}
