import { Button, ErrorBoundary, FormError, Input } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import type { TunnelState } from '@ruimte/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { machineMode, openInSystemBrowser } from '@/desktop/bridge';
import { usePickedMachine } from '@/shell/settings/picked-machine';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { CredentialsSection } from '@/shell/settings/tunnels/CredentialsSection';
import { TunnelRows } from '@/shell/settings/tunnels/TunnelRows';
import { useTunnels } from '@/shell/settings/tunnels/use-tunnels';
import { LOCAL_ENDPOINT_ID, type Endpoint } from '@/state/endpoints';

/*
 * Reaching Ruimte's MCP and your dev servers from outside, under your own Cloudflare account. Only the desktop app on the
 * machine it runs manages them; any other window reads the state and changes nothing.
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

    return (
        <>
            <SettingsSection title={t('tunnels.title')} description={t('tunnels.description')} scope="machine" machine="picked">
                {waiting !== null && <SettingsRow label={waiting} />}
                {tunnels.failure !== null && <FormError>{tunnels.failure}</FormError>}
                {state !== null && manages && <Stage state={state} change={tunnels.change} />}
                {state !== null && !manages && tunnels.answers && <ReadOnlyRows state={state} />}
            </SettingsSection>
            {state !== null && manages && (state.stage === 'running' || state.stage === 'starting') && (
                <TunnelRows state={state} change={tunnels.change} endpointId={endpoint.id} />
            )}
            {state !== null && manages && <CredentialsSection endpointId={endpoint.id} state={state} credentials={tunnels.credentials} reload={tunnels.load} />}
        </>
    );
}

/* The address cloudflared printed, opened in the person's browser the moment it is known. */
function OpenOnce({ url }: { url: string }) {
    useEffect(() => {
        openInSystemBrowser(url);
    }, [url]);

    return null;
}

/* What a window that does not manage the tunnels still sees: whether they run, and how many clients use them. */
function ReadOnlyRows({ state }: { state: TunnelState }) {
    const { t } = useTranslation('settings');

    return <SettingsRow label={t(`tunnels.stage.${state.stage}`)} description={t('tunnels.clients', { count: state.clients })} />;
}

type Change = (type: 'tunnel.install' | 'tunnel.signIn' | 'tunnel.setup' | 'tunnel.retry', payload?: object) => Promise<void>;

/* The screen as far as there are hostnames: install, sign in, a domain, and what went wrong. */
function Stage({ state, change }: { state: TunnelState; change: Change }) {
    const { t } = useTranslation('settings');
    const [domain, setDomain] = useState('');

    switch (state.stage) {
        case 'not-installed':
            return (
                <SettingsRow
                    label={t('tunnels.install.label')}
                    description={t('tunnels.install.description')}
                    control={<Button onClick={() => void change('tunnel.install')}>{t('tunnels.install.action')}</Button>}
                />
            );
        case 'installing':
            return <SettingsRow label={t('tunnels.stage.installing')} />;
        case 'cannot-install':
            return <SettingsRow label={t('tunnels.cannotInstall')} description={state.message ?? undefined} />;
        case 'signed-out':
            return (
                <SettingsRow
                    label={t('tunnels.signIn.label')}
                    description={t('tunnels.signIn.description')}
                    control={
                        <Button
                            variant="primary"
                            onClick={() => {
                                void change('tunnel.signIn');
                            }}
                        >
                            {t('tunnels.signIn.action')}
                        </Button>
                    }
                />
            );
        case 'signing-in':
            return (
                <SettingsRow
                    label={t('tunnels.stage.signing-in')}
                    description={t('tunnels.signIn.waiting')}
                    control={
                        state.signInUrl === null ? undefined : (
                            <>
                                <OpenOnce url={state.signInUrl} />
                                <Button onClick={() => openInSystemBrowser(state.signInUrl!)}>{t('tunnels.signIn.open')}</Button>
                            </>
                        )
                    }
                />
            );
        case 'no-tunnel':
            return (
                <SettingsRow
                    label={t('tunnels.domain.label')}
                    description={t('tunnels.domain.description')}
                    control={
                        <div className="flex items-center gap-1.5">
                            <Input
                                aria-label={t('tunnels.domain.label')}
                                placeholder="example.com"
                                spellCheck={false}
                                value={domain}
                                onChange={(e) => setDomain(e.target.value)}
                            />
                            <Button variant="primary" disabled={domain.trim().length < 3} onClick={() => void change('tunnel.setup', { domain })}>
                                {t('tunnels.domain.action')}
                            </Button>
                        </div>
                    }
                />
            );
        case 'failed':
            return (
                <SettingsRow
                    label={t('tunnels.stage.failed')}
                    description={state.message ?? undefined}
                    control={<Button onClick={() => void change('tunnel.retry')}>{t('tunnels.retry')}</Button>}
                />
            );
        default:
            return <SettingsRow label={t(`tunnels.stage.${state.stage}`)} description={t('tunnels.visibility')} />;
    }
}
