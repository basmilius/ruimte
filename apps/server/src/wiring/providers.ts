import { cliExecutable, type ProviderAccountsService } from '@adecore/agents/providers';
import type { AgentKind } from '@ruimte/contracts';
import { ownsSettings } from '../agents/install.ts';
import { AgentIntegrations } from '../agents/integrations.ts';
import { bestEffort } from '../best-effort.ts';
import type { ServerConfig } from '../config.ts';
import { AcpRegistry } from '../providers/acp-registry.ts';
import type { AnthropicClaudeApiService } from '../providers/anthropic-claude-api-service.ts';
import { CliVersions, type OwnInstall } from '../providers/cli-versions.ts';
import { ModelCatalogFeed } from '../providers/model-catalogs.ts';
import type { NanoGptService } from '../providers/nanogpt-service.ts';
import { ProviderFeed } from '../providers/provider-feed.ts';
import { RegistryAgents } from '../providers/registry-agents.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { modelFeedKinds } from '../providers/table.ts';
import type { DaemonSeams } from './seams.ts';

/* The agent CLIs of this machine, their accounts and what a person allowed in their settings. */
export interface ProvidersBundle {
    nanogpt: NanoGptService;
    claudeApi: AnthropicClaudeApiService;
    providers: ProviderRegistry;
    // The provider list again, to every client, when an agent reported something new about itself.
    feed: ProviderFeed;
    modelCatalogs: ModelCatalogFeed;
    integrations: AgentIntegrations;
    accounts: ProviderAccountsService;
    // The agents of the ACP registry a person installed, each a provider of its own.
    registryAgents: RegistryAgents;
    // How each CLI was installed, its version and an update through that route.
    versions: CliVersions;
    nameOfCli(kind: AgentKind): string;
    // Reads the models of the agents whose list changes on the vendor's side again, where the last read is a day old.
    refreshModels(): Promise<void>;
}

/*
 * `alongside` loads beside the providers' own files, so neither waits on the other. `fetched` runs
 * wherever the model catalogs may be fetched, for the usage counts that go out at the same moments.
 */
export async function wireProviders(
    config: ServerConfig,
    alongside: () => Promise<void>,
    fetched: () => void,
    seams: Pick<DaemonSeams, 'providers' | 'accounts'>
): Promise<ProvidersBundle> {
    const providers = new ProviderRegistry({
        home: config.home,
        ...(seams.providers.codexHelp === null ? {} : { commands: { codexHelp: seams.providers.codexHelp } }),
        ...(seams.providers.detect === null ? {} : { detect: seams.providers.detect }),
        onList: () => {
            void integrations.refreshInstalled();
            void modelCatalogs.refresh();
            fetched();
        }
    });
    const { nanogpt, claudeApi } = providers;
    await Promise.all([nanogpt.load(config.home), claudeApi.load(config.home)]);

    for (const provider of seams.providers.added) {
        providers.add(provider);
    }
    const modelCatalogs = new ModelCatalogFeed({
        home: config.home,
        allowFetch: config.modelFetch,
        catalogs: Object.fromEntries(modelFeedKinds().map((kind) => [kind, providers.catalogFor(kind)])),
        // The Claude API takes its options from Claude Code's catalog, which may now know a model it did not.
        changed: () => claudeApi.rebuildCatalog()
    });
    // What a person allowed in the CLIs' global settings; the accounts below ask it before they write anywhere.
    const integrations = new AgentIntegrations({
        home: config.home,
        fixed: !config.installHooks,
        accountHomes: (kind) => {
            // A CLI whose accounts run apart keeps its default account in a folder of the daemon's own too.
            const apartDefault = providers.get(kind).home?.apart?.defaultFolder;
            const extra = Object.entries(accounts.snapshot().accounts)
                .filter(([id, account]) => account.kind === kind && id !== kind && account.home !== undefined)
                .map(([, account]) => account.home!);

            return apartDefault === undefined ? extra : [apartDefault, ...extra];
        },
        installed: async (kind) => {
            const command = cliExecutable(providers.get(kind));
            const detect = seams.providers.detect;

            return (detect === null ? await providers.get(kind).detect(command, process.env) : await detect(command)).installed;
        }
    });
    await Promise.all([integrations.load(), modelCatalogs.load(), alongside()]);
    void modelCatalogs.refresh();
    fetched();
    // Before the managers, which start every CLI under the account its node or chat names.
    const accounts = seams.accounts({ home: config.home, providers, install: (kind, folder) => integrations.installFolder(kind, folder), ownsSettings });
    await accounts.load();
    const refresh = seams.providers.refreshModels;
    const refreshModels = (): Promise<void> =>
        refresh === null ? Promise.resolve() : bestEffort('Reading the models of the agents', refresh(providers, accounts, process.env));
    // At the start, so a list the vendor changed while the machine was off is in the first picker.
    void refreshModels();
    const registry = new AcpRegistry({ home: config.home });
    const registryAgents = new RegistryAgents({ home: config.home, registry, providers });
    registryAgents.load();
    const ownInstall = (kind: AgentKind): OwnInstall | null => {
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
        executables: { claude: 'claude', codex: 'codex', antigravity: 'agy', grok: 'grok', copilot: 'copilot' },
        own: ownInstall,
        ownKinds: () => registryAgents.installed().map((agent) => agent.kind),
        providers
    });
    // Before the feed listens, so the list it sends reads the new key instead of the cached detection.
    nanogpt.onChange(() => providers.invalidate('nanogpt'));
    // Its account is checked against the detection too, which said "not found" while no key was saved.
    claudeApi.onChange(() => {
        providers.invalidate('anthropic-claude-api');
        void accounts.refresh();
    });
    return {
        nanogpt,
        claudeApi,
        providers,
        feed: new ProviderFeed(providers),
        modelCatalogs,
        integrations,
        accounts,
        registryAgents,
        versions,
        nameOfCli: (kind) => providers.get(kind).name,
        refreshModels
    };
}
