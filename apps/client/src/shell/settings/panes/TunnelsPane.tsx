import { ErrorBoundary, FormError } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import type { TunnelState } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { machineMode } from '@/desktop/bridge';
import { usePickedMachine } from '@/shell/settings/picked-machine';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { CloudflareRows } from '@/shell/settings/tunnels/CloudflareRows';
import { CredentialsSection } from '@/shell/settings/tunnels/CredentialsSection';
import { HostnamesSection } from '@/shell/settings/tunnels/HostnamesSection';
import { useTunnels } from '@/shell/settings/tunnels/use-tunnels';
import { LOCAL_ENDPOINT_ID, type Endpoint } from '@/state/endpoints';

/*
 * Reaching Ruimte's MCP and your dev servers from outside, through a tunnel on your own Cloudflare account. Only the
 * desktop app on the machine it runs manages them; any other window reads the state and changes nothing.
 */
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
    const tunnels = useTunnels(endpoint.id);
    const manages = endpoint.id === LOCAL_ENDPOINT_ID && machineMode() === 'local';
    const { state } = tunnels;
    const waiting = !tunnels.open
        ? t('machine.notAnswering')
        : !tunnels.answers
          ? t('tunnels.update')
          : state === null
            ? t('tunnels.loading')
            : !manages
              ? t('tunnels.elsewhere')
              : null;
    const linked = state !== null && state.tunnel !== null && state.hasToken && (state.stage === 'running' || state.stage === 'starting');

    return (
        <>
            <SettingsSection title={t('tunnels.cloudflare')} scope="machine" machine="picked">
                {waiting !== null && <SettingsRow label={waiting} />}
                {state !== null && manages && <CloudflareRows state={state} endpointId={endpoint.id} change={tunnels.change} />}
                {state !== null && !manages && tunnels.answers && <ReadOnlyRows state={state} />}
            </SettingsSection>
            {tunnels.failure !== null && <FormError>{tunnels.failure}</FormError>}
            {state !== null && manages && linked && (
                <HostnamesSection state={state} endpointId={endpoint.id} change={tunnels.change} attempt={tunnels.attempt} />
            )}
            {state !== null && manages && (
                <CredentialsSection endpointId={endpoint.id} state={state} credentials={tunnels.credentials} reload={tunnels.load} change={tunnels.change} />
            )}
        </>
    );
}

/* What a window that does not manage the tunnels still sees: whether they run, and how many clients use them. */
function ReadOnlyRows({ state }: { state: TunnelState }) {
    const { t } = useTranslation('settings');

    return <SettingsRow label={t(`tunnels.stage.${state.stage}`)} description={t('tunnels.clients', { count: state.clients })} />;
}
