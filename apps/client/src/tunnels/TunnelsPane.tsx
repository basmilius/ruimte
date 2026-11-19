import { ErrorBoundary, FormError, Spinner } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import type { TunnelState } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { usePickedMachine } from '@/machines/picked-machine';
import { SettingsSection } from '@/machines/SettingsSection';
import type { Endpoint } from '@/state/endpoints';
import { CloudflareRows } from '@/tunnels/CloudflareRows';
import { HostnamesSection } from '@/tunnels/HostnamesSection';
import { useMachineTunnels } from '@/tunnels/use-machine-tunnels';

/* Reaching your dev servers and Ruimte's MCP from outside, through a tunnel on your own Cloudflare account. */
export function TunnelsPane() {
    const { t } = useTranslation('settings');
    const endpoint = usePickedMachine();

    if (endpoint === null) {
        return null;
    }

    return (
        <ErrorBoundary key={endpoint.id} label={t('tunnels.failed')}>
            <TunnelsOf endpoint={endpoint} />
        </ErrorBoundary>
    );
}

function TunnelsOf({ endpoint }: { endpoint: Endpoint }) {
    const { t } = useTranslation('settings');
    const { tunnels, manages, waiting, loading } = useMachineTunnels(endpoint, t('tunnels.elsewhere'));
    const { state } = tunnels;
    // Also while a stage failed: a refused change or a crashed child says so in the tunnel's line, and the hostnames stay.
    const linked = state !== null && state.tunnel !== null && state.hasToken;

    return (
        <>
            <SettingsSection title={t('tunnels.cloudflare')} scope="machine" machine="picked">
                {waiting !== null && <SettingsRow label={waiting} leading={loading ? <Spinner size={12} /> : undefined} />}
                {state !== null && manages && <CloudflareRows state={state} endpointId={endpoint.id} change={tunnels.change} />}
                {state !== null && !manages && tunnels.answers && <ReadOnlyRows state={state} />}
            </SettingsSection>
            {tunnels.failure !== null && <FormError>{tunnels.failure}</FormError>}
            {state !== null && manages && linked && (
                <HostnamesSection state={state} endpointId={endpoint.id} change={tunnels.change} attempt={tunnels.attempt} />
            )}
        </>
    );
}

/* What a window that does not manage the tunnels still sees: whether they run, and how many clients use them. */
function ReadOnlyRows({ state }: { state: TunnelState }) {
    const { t } = useTranslation('settings');

    return <SettingsRow label={t(`tunnels.stage.${state.stage}`)} description={t('tunnels.clients', { count: state.clients })} />;
}
