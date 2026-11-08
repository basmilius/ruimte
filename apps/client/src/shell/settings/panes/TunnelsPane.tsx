import { Button, ErrorBoundary, FormError, Input, Select } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import type { TunnelState } from '@ruimte/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { machineMode, openInSystemBrowser } from '@/desktop/bridge';
import { usePickedMachine } from '@/shell/settings/picked-machine';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { CLOUDFLARE_TOKEN_URL } from '@/shell/settings/tunnels/cloudflare-token-link';
import { CredentialsSection } from '@/shell/settings/tunnels/CredentialsSection';
import { TunnelRows } from '@/shell/settings/tunnels/TunnelRows';
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
    const installed = state !== null && state.stage !== 'not-installed' && state.stage !== 'installing' && state.stage !== 'cannot-install';

    return (
        <>
            <SettingsSection title={t('tunnels.title')} scope="machine" machine="picked">
                {waiting !== null && <SettingsRow label={waiting} />}
                {tunnels.failure !== null && <FormError>{tunnels.failure}</FormError>}
                {state !== null && manages && <Stage state={state} change={tunnels.change} />}
                {state !== null && manages && installed && <TokenRow state={state} change={tunnels.change} />}
                {state !== null && !manages && tunnels.answers && <ReadOnlyRows state={state} />}
            </SettingsSection>
            {state !== null && manages && state.tunnel !== null && state.hasToken && (state.stage === 'running' || state.stage === 'starting') && (
                <TunnelRows state={state} change={tunnels.change} endpointId={endpoint.id} />
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

type Change = (type: 'tunnel.install' | 'tunnel.setToken' | 'tunnel.clearToken' | 'tunnel.setup' | 'tunnel.retry', payload?: object) => Promise<void>;

/* The API token: a field and a link to make one while there is none, and a way to take it away once Cloudflare accepted it. */
function TokenRow({ state, change }: { state: TunnelState; change: Change }) {
    const { t } = useTranslation('settings');
    const [token, setToken] = useState('');

    if (state.hasToken) {
        return (
            <SettingsRow
                label={t('tunnels.token.label')}
                description={
                    state.account === null
                        ? t('tunnels.token.acceptedAccounts', { count: state.zoneCount ?? 0, accounts: state.accounts.length })
                        : t('tunnels.token.accepted', { count: state.zones.length, account: state.account.name })
                }
                control={<Button onClick={() => void change('tunnel.clearToken')}>{t('tunnels.token.remove')}</Button>}
            />
        );
    }

    return (
        <SettingsRow
            label={t('tunnels.token.label')}
            description={t('tunnels.token.description')}
            control={
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <Input
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={t('tunnels.token.label')}
                        placeholder={t('tunnels.token.placeholder')}
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                    />
                    <Button onClick={() => openInSystemBrowser(CLOUDFLARE_TOKEN_URL)}>{t('tunnels.token.make')}</Button>
                    <Button
                        variant="primary"
                        disabled={token.trim().length < 10}
                        onClick={() => {
                            void change('tunnel.setToken', { token: token.trim() });
                            setToken('');
                        }}
                    >
                        {t('tunnels.token.action')}
                    </Button>
                </div>
            }
        />
    );
}

/* The screen as far as there are hostnames: install, checking the token, making the tunnel, and what went wrong. */
function Stage({ state, change }: { state: TunnelState; change: Change }) {
    const { t } = useTranslation('settings');
    const [picked, setPicked] = useState<string | null>(null);
    const account = picked ?? state.account?.id ?? null;

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
        case 'no-token':
            return null;
        case 'checking':
            return <SettingsRow label={t('tunnels.stage.checking')} />;
        case 'no-tunnel':
            return (
                <SettingsRow
                    label={t('tunnels.tunnel.label')}
                    description={t('tunnels.tunnel.description')}
                    control={
                        <div className="flex items-center gap-1.5">
                            {state.accounts.length > 1 && (
                                <Select<string>
                                    label={t('tunnels.tunnel.account')}
                                    variant="outlined"
                                    value={account ?? ''}
                                    placeholder={t('tunnels.tunnel.pickAccount')}
                                    items={state.accounts.map((entry) => ({ value: entry.id, label: entry.name }))}
                                    onValueChange={setPicked}
                                />
                            )}
                            <Button
                                variant="primary"
                                disabled={account === null}
                                onClick={() => void change('tunnel.setup', account === null ? {} : { account })}
                            >
                                {t('tunnels.tunnel.action')}
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
