import { ProvidersPane as Pane } from '@adecore/agents-react/providers';
import { useProvidersStore } from '@adecore/agents-react/state';
import type { AgentKind, ProviderInfo } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { AcpServerSection, AcpServerStepBody } from '@/providers/AcpServerSection';
import { ClaudeApiSection, NanoGptSection } from '@/providers/ApiKeySection';
import { CliVersionSection } from '@/providers/CliVersionSection';
import { RegistryCatalogPage } from '@/providers/RegistryCatalogPage';
import { useAcpServer } from '@/providers/use-acp-server';
import { useCliVersions, useRegistryCatalog } from '@/providers/use-provider-installs';
import { useEndpointId } from '@/state/current-endpoint';
import { useUi } from '@/state/ui';
import { useMachineAnswers } from '@/transport/features';
import { useDetectProviders } from '@/transport/provider-detection';

/* The registry is read only once a person opens the page to add a provider. */
function RegistryCatalog({ endpointId, onOpen }: { endpointId: string; onOpen(kind: AgentKind): void }) {
    const registry = useRegistryCatalog(endpointId);
    return <RegistryCatalogPage registry={registry} onOpen={onOpen} />;
}

export function ProvidersPane() {
    const { t } = useTranslation('settings');
    const endpointId = useEndpointId();
    const target = useUi((s) => s.settings.target);
    const antigravity = useAcpServer(endpointId, 'antigravity');
    const registryAnswers = useMachineAnswers(endpointId, 'provider.registry');
    const versions = useCliVersions(endpointId);
    const providers = useProvidersStore((s) => s.byScope[endpointId]?.providers);
    const claudeInstalled = providers?.find((provider) => provider.kind === 'claude')?.installed !== false;
    useDetectProviders();
    const detailOf = (provider: ProviderInfo) => {
        if (provider.kind === 'anthropic-claude-api') {
            return <ClaudeApiSection key={endpointId} endpointId={endpointId} />;
        }
        if (provider.kind === 'nanogpt') {
            return <NanoGptSection key={endpointId} endpointId={endpointId} />;
        }
        if (provider.kind !== 'antigravity') {
            return null;
        }
        return antigravity.server === null ? null : <AcpServerSection provider={provider} acp={antigravity} server={antigravity.server} />;
    };
    // The server is the step after the CLI; none while the machine has not said where it stands.
    const installStepOf = (provider: ProviderInfo) =>
        provider.kind !== 'antigravity' || antigravity.server === null
            ? null
            : {
                  title: t('providers.acpServer.step'),
                  done: antigravity.server.state === 'installed',
                  body: <AcpServerStepBody acp={antigravity} server={antigravity.server} />
              };
    // Off is a choice only a Mac offers; elsewhere the detail says why the model is not there.
    const setupStatusOf = (provider: ProviderInfo) => {
        // The machine reports a provider behind a key installed once a saved key brought it models.
        // It also needs Claude Code, which it runs in.
        if (provider.kind === 'anthropic-claude-api' && !provider.installed) {
            return { text: t(claudeInstalled ? 'providers.claudeApi.noKey' : 'providers.claudeApi.noCli'), tone: 'warning' as const };
        }
        if (provider.kind === 'nanogpt' && !provider.installed) {
            return { text: t('providers.nanogpt.noKey'), tone: 'warning' as const };
        }
        return null;
    };
    const sectionsOf = (provider: ProviderInfo) => {
        const version = versions.versionOf(provider.kind);
        return version === null ? null : <CliVersionSection provider={provider} versions={versions} version={version} />;
    };
    return (
        <Pane
            target={target}
            detailOf={detailOf}
            installStepOf={installStepOf}
            setupStatusOf={setupStatusOf}
            sectionsOf={sectionsOf}
            {...(registryAnswers ? { addPage: (added: (kind: AgentKind) => void) => <RegistryCatalog endpointId={endpointId} onOpen={added} /> } : {})}
        />
    );
}
