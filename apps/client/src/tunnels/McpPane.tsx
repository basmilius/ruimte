import { Button, ErrorBoundary, FormError, Spinner } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import type { TunnelState } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { usePickedMachine } from '@/machines/picked-machine';
import { SettingsSection } from '@/machines/SettingsSection';
import type { Endpoint } from '@/state/endpoints';
import { useUi } from '@/state/ui';
import { CredentialsSection } from '@/tunnels/CredentialsSection';
import { useMachineTunnels } from '@/tunnels/use-machine-tunnels';

/* The external MCP and the clients that hold a credential for it. It listens on this machine; a tunnel brings it outside. */
export function McpPane() {
    const { t } = useTranslation('settings');
    const endpoint = usePickedMachine();

    if (endpoint === null) {
        return null;
    }

    return (
        <ErrorBoundary key={endpoint.id} label={t('tunnels.failed')}>
            <McpOf endpoint={endpoint} />
        </ErrorBoundary>
    );
}

function McpOf({ endpoint }: { endpoint: Endpoint }) {
    const { t } = useTranslation('settings');
    const { tunnels, manages, waiting, loading } = useMachineTunnels(endpoint, t('mcp.elsewhere'));
    const { state } = tunnels;

    return (
        <>
            {waiting !== null && (
                <SettingsSection title={t('tunnels.clients.title')} scope="machine" machine="picked">
                    <SettingsRow label={waiting} leading={loading ? <Spinner size={12} /> : undefined} />
                </SettingsSection>
            )}
            {tunnels.failure !== null && <FormError>{tunnels.failure}</FormError>}
            {state !== null && manages && (
                <>
                    <CredentialsSection
                        endpointId={endpoint.id}
                        state={state}
                        credentials={tunnels.credentials}
                        reload={tunnels.load}
                        change={tunnels.change}
                    />
                    <OutsideSection state={state} />
                </>
            )}
        </>
    );
}

/* Where a client outside this machine reaches the MCP: the Ruimte MCP hostname on the tunnel, set up under Tunnels. */
function OutsideSection({ state }: { state: TunnelState }) {
    const { t } = useTranslation('settings');
    const setSettings = useUi((s) => s.setSettings);
    const hostname = state.rows.find((row) => row.kind === 'mcp')?.hostname;

    return (
        <SettingsSection>
            <SettingsRow
                label={t('mcp.outside.label')}
                description={hostname === undefined ? t('mcp.outside.none') : t('mcp.outside.through', { hostname })}
                control={
                    <Button size="sm" onClick={() => setSettings({ section: 'tunnels' })}>
                        {t('mcp.outside.open')}
                    </Button>
                }
            />
        </SettingsSection>
    );
}
