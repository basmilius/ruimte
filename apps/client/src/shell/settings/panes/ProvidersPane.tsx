import { useTranslation } from 'react-i18next';
import type { AgentKind, ProviderInfo } from '@ruimte/contracts';
import { ProvidersPane as Pane } from '@adecore/agents-react/providers';
import { AcpServerSection, AcpServerStepBody } from '@/shell/settings/providers/AcpServerSection';
import { useAcpServer } from '@/shell/settings/providers/use-acp-server';
import { AppleFoundationSection } from '@/shell/settings/providers/AppleFoundationSection';
import { CliVersionSection } from '@/shell/settings/providers/CliVersionSection';
import { NanoGptSection } from '@/shell/settings/providers/NanoGptSection';
import { RegistryCatalogPage } from '@/shell/settings/providers/RegistryCatalogPage';
import { useCliVersions, useRegistryCatalog } from '@/shell/settings/providers/use-provider-installs';
import { useMachineAnswers } from '@/transport/features';
import { useEndpointId } from '@/state/keys';
import { useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { useDetectProviders } from '@/transport/provider-detection';

/* The registry is read only once a person opens the page to add a provider. */
function RegistryCatalog({ endpointId, onOpen }: { endpointId: string; onOpen(kind: AgentKind): void }) {
    const registry = useRegistryCatalog(endpointId);
    return <RegistryCatalogPage registry={registry} onOpen={onOpen} />;
}

/* The providers of the machine in scope, with the model that machine runs on its own drawn by Ruimte. */
export function ProvidersPane() {
    const { t } = useTranslation('settings');
    const endpointId = useEndpointId();
    const target = useUi((s) => s.settings.target);
    const antigravity = useAcpServer(endpointId, 'antigravity');
    const machine = useServers((s) => s.byEndpoint[endpointId]);
    const registryAnswers = useMachineAnswers(endpointId, 'provider.registry');
    const versions = useCliVersions(endpointId);
    useDetectProviders();
    const detailOf = (provider: ProviderInfo) => {
        if (provider.kind === 'nanogpt') {
            return <NanoGptSection key={endpointId} endpointId={endpointId} />;
        }
        if (provider.kind === 'apple') {
            return <AppleFoundationSection endpointId={endpointId} provider={provider} />;
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
        if (provider.kind === 'apple' && machine?.platform === 'darwin' && !machine.appleFoundationEnabled) {
            return { text: t('providers.apple.off'), tone: 'muted' as const };
        }
        // The machine reports NanoGPT installed once a saved key brought it models.
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
