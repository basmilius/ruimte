import type { AgentKind } from '@ruimte/contracts';
import { ProviderAccountsService } from '@adecore/agents/providers';
import { AgentIntegrations } from '../agents/integrations.ts';
import type { EndpointIdentity } from '../endpoint-id.ts';
import { RUIMTE_ACCOUNTS_HOST } from '../providers/accounts-host.ts';
import { ANTIGRAVITY_ACP_RELEASE } from '../providers/acp-providers.ts';
import { AcpRegistry } from '../providers/acp-registry.ts';
import { AcpServerInstall } from '../providers/acp-server.ts';
import { CliVersions, type OwnInstall } from '../providers/cli-versions.ts';
import { RegistryAgents } from '../providers/registry-agents.ts';
import type { AgentServers } from '../handlers/agent-servers.ts';
import { RUIMTE_CODEX_CLIENT } from '../providers/codex-provider.ts';
import { terminalExecutable } from '../providers/launch.ts';
import { ModelCatalogFeed } from '../providers/model-catalogs.ts';
import { ProviderFeed } from '../providers/provider-feed.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import type { ServerConfig } from '../config.ts';
import { nanoGptService } from '../providers/nanogpt-provider.ts';
import type { NanoGptService } from '../providers/nanogpt-service.ts';

/* The agent CLIs of this machine, their accounts and what a person allowed in their settings. */
export interface ProvidersBundle {
    nanogpt: NanoGptService;
    providers: ProviderRegistry;
    // The provider list again, to every client, when an agent reported something new about itself.
    feed: ProviderFeed;
    modelCatalogs: ModelCatalogFeed;
    integrations: AgentIntegrations;
    accounts: ProviderAccountsService;
    // The chat servers a person installs apart from their CLI (Antigravity's).
    servers: AgentServers;
    // The agents of the ACP registry a person installed, each a provider of its own.
    registryAgents: RegistryAgents;
    // How each CLI was installed, its version and an update through that route.
    versions: CliVersions;
    nameOfCli(kind: AgentKind): string;
}

/*
 * `alongside` loads beside the providers' own files, so neither waits on the other. `fetched` runs
 * wherever the model catalogs may be fetched, for the usage counts that go out at the same moments.
 */
export async function wireProviders(
    config: ServerConfig,
    identity: EndpointIdentity,
    alongside: () => Promise<void>,
    fetched: () => void = () => undefined
): Promise<ProvidersBundle> {
    const nanogpt = nanoGptService;
    await nanogpt.load(config.home);
    const antigravityServer = new AcpServerInstall({ provider: 'antigravity', home: config.home, release: ANTIGRAVITY_ACP_RELEASE });
    const providers = new ProviderRegistry({
        appleEnabled: () => identity.appleFoundationEnabled,
        antigravityServer,
        home: config.home,
        onList: () => {
            void integrations.refreshInstalled();
            void modelCatalogs.refresh();
            fetched();
        }
    });
    const modelCatalogs = new ModelCatalogFeed({
        home: config.home,
        allowFetch: config.modelFetch,
        catalogs: Object.fromEntries((['claude', 'codex', 'antigravity', 'copilot', 'grok'] as const).map((kind) => [kind, providers.catalogFor(kind)]))
    });
    // What a person allowed in the CLIs' global settings; the accounts below ask it before they write anywhere.
    const integrations = new AgentIntegrations({
        home: config.home,
        fixed: !config.installHooks,
        accountHomes: (kind) =>
            Object.entries(accounts.snapshot().accounts)
                .filter(([id, account]) => account.kind === kind && id !== kind && account.home !== undefined)
                .map(([, account]) => account.home!),
        installed: async (kind) => (await providers.get(kind).detect(terminalExecutable(kind), process.env)).installed
    });
    await Promise.all([integrations.load(), modelCatalogs.load(), alongside()]);
    void modelCatalogs.refresh();
    fetched();
    identity.attachAgentIntegrations({ describe: () => ({ agentIntegrations: integrations.summary() }) });
    // Before the managers, which start every CLI under the account its node or chat names.
    const accounts = new ProviderAccountsService({
        home: config.home,
        host: RUIMTE_ACCOUNTS_HOST,
        client: RUIMTE_CODEX_CLIENT,
        providers,
        install: (kind, folder) => integrations.installFolder(kind, folder)
    });
    await accounts.load();
    const servers: AgentServers = {
        of: (kind) => (kind === 'antigravity' ? antigravityServer : undefined),
        installed: (kind) => {
            providers.invalidate(kind);
            void integrations.refreshInstalled();
        }
    };
    const registry = new AcpRegistry({ home: config.home });
    const registryAgents = new RegistryAgents({ home: config.home, registry, providers });
    registryAgents.load();
    const ownInstall = (kind: AgentKind): OwnInstall | null => {
        if (kind === 'antigravity') {
            const status = antigravityServer.status();
            return {
                version: status.installed,
                path: antigravityServer.launch()?.[0] ?? null,
                latest: () => Promise.resolve(ANTIGRAVITY_ACP_RELEASE.version),
                update: async () => {
                    const after = await antigravityServer.install();
                    servers.installed(kind);
                    if (after.state === 'failed') {
                        throw new Error(after.error ?? 'The Antigravity server did not install');
                    }
                }
            };
        }
        const agent = registryAgents.installed().find((candidate) => candidate.kind === kind);
        if (agent === undefined) {
            return null;
        }
        return {
            version: agent.version,
            path: registryAgents.launch(agent)[0] ?? null,
            latest: async (refresh) => (await registry.read(refresh)).entries.find((entry) => entry.id === agent.id)?.version ?? null,
            update: async () => {
                const after = await registryAgents.install(agent.id);
                if (after.state === 'failed') {
                    throw new Error(after.error ?? `${agent.name} did not install`);
                }
            }
        };
    };
    const versions = new CliVersions({
        executables: { claude: 'claude', codex: 'codex', grok: 'grok', copilot: 'copilot' },
        own: ownInstall,
        ownKinds: () => ['antigravity', ...registryAgents.installed().map((agent) => agent.kind)],
        providers
    });
    // Before the feed listens, so the list it sends reads the new key instead of the cached detection.
    nanogpt.onChange(() => providers.invalidate('nanogpt'));
    return {
        nanogpt,
        providers,
        feed: new ProviderFeed(providers),
        modelCatalogs,
        integrations,
        accounts,
        servers,
        registryAgents,
        versions,
        nameOfCli: (kind) => providers.get(kind).name
    };
}
