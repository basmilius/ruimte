import type { ProviderInfo } from '@ruimte/contracts';
import { ProvidersPane as Pane } from '@adecore/agents-react/providers';
import { AppleFoundationSection } from '@/shell/settings/providers/AppleFoundationSection';
import { ClaudeApiSection } from '@/shell/settings/providers/ClaudeApiSection';
import { NanoGptSection } from '@/shell/settings/providers/NanoGptSection';
import { useEndpointId } from '@/state/keys';
import { useUi } from '@/state/ui';

/* The providers of the machine in scope, with the model that machine runs on its own drawn by Ruimte. */
export function ProvidersPane() {
    const endpointId = useEndpointId();
    const target = useUi((s) => s.settings.target);
    const detailOf = (provider: ProviderInfo) =>
        provider.kind === 'nanogpt' ? (
            <NanoGptSection key={endpointId} endpointId={endpointId} />
        ) : provider.kind === 'anthropic-claude-api' ? (
            <ClaudeApiSection key={endpointId} endpointId={endpointId} />
        ) : provider.kind === 'apple' ? (
            <AppleFoundationSection endpointId={endpointId} provider={provider} />
        ) : null;
    return <Pane target={target} detailOf={detailOf} />;
}
