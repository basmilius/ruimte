import { useTranslation } from 'react-i18next';
import type { ProviderInfo } from '@ruimte/contracts';
import { ProvidersPane as Pane } from '@adecore/agents-react/providers';
import { AcpServerSection, AcpServerStepBody } from '@/shell/settings/providers/AcpServerSection';
import { useAcpServer } from '@/shell/settings/providers/use-acp-server';
import { AppleFoundationSection } from '@/shell/settings/providers/AppleFoundationSection';
import { useEndpointId } from '@/state/keys';
import { useUi } from '@/state/ui';
import { useDetectProviders } from '@/transport/provider-detection';

/* The providers of the machine in scope, with the model that machine runs on its own drawn by Ruimte. */
export function ProvidersPane() {
    const { t } = useTranslation('settings');
    const endpointId = useEndpointId();
    const target = useUi((s) => s.settings.target);
    const antigravity = useAcpServer(endpointId, 'antigravity');
    useDetectProviders();
    const detailOf = (provider: ProviderInfo) => {
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
    return <Pane target={target} detailOf={detailOf} installStepOf={installStepOf} />;
}
