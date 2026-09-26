import type { ProviderInfo } from '@ruimte/contracts';
import { ProvidersPane as Pane } from '@ruimte/agents-react/providers/ProvidersPane';
import { AppleFoundationSection } from '@/shell/settings/providers/AppleFoundationSection';
import { useEndpointId } from '@/state/keys';
import { useUi } from '@/state/ui';

/* The providers of the machine in scope, with the model that machine runs on its own drawn by Ruimte. */
export function ProvidersPane() {
    const endpointId = useEndpointId();
    const target = useUi((s) => s.settings.target);
    const detailOf = (provider: ProviderInfo) => (provider.kind === 'apple' ? <AppleFoundationSection endpointId={endpointId} provider={provider} /> : null);
    return <Pane target={target} detailOf={detailOf} />;
}
