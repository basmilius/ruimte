import { Button, Input, messageOf, Select } from '@adecore/ui';
import { ConfirmDialog, SettingsRow } from '@adecore/ui/settings';
import type { TunnelExisting, TunnelState } from '@ruimte/contracts';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openInSystemBrowser } from '@/desktop/bridge';
import { CLOUDFLARE_TOKEN_URL } from '@/shell/settings/tunnels/cloudflare-token-link';
import type { TunnelChange } from '@/shell/settings/tunnels/use-tunnels';
import { transportFor } from '@/transport';

const NEW_TUNNEL = 'new';

type Tone = 'running' | 'idle' | 'error';

const DOT = { running: 'bg-status-running', idle: 'bg-status-idle', error: 'bg-status-error' } as const;

/* The rows of the Cloudflare card: cloudflared while it is missing, the API token, and the tunnel. */
export function CloudflareRows({ state, endpointId, change }: { state: TunnelState; endpointId: string; change: TunnelChange }) {
    if (state.stage === 'not-installed' || state.stage === 'installing' || state.stage === 'cannot-install') {
        return <InstallRow state={state} change={change} />;
    }

    return (
        <>
            <TokenRow state={state} change={change} />
            {state.hasToken && <TunnelRow state={state} endpointId={endpointId} change={change} />}
        </>
    );
}

function InstallRow({ state, change }: { state: TunnelState; change: TunnelChange }) {
    const { t } = useTranslation('settings');

    return (
        <SettingsRow
            label={t(`tunnels.stage.${state.stage}`)}
            description={state.stage === 'cannot-install' ? (state.message ?? undefined) : undefined}
            control={state.stage === 'not-installed' ? <Button onClick={() => void change('tunnel.install')}>{t('tunnels.install.action')}</Button> : undefined}
        />
    );
}

/* A field and a link to make a token while there is none; once Cloudflare accepted it, what it reaches and Remove. */
function TokenRow({ state, change }: { state: TunnelState; change: TunnelChange }) {
    const { t } = useTranslation('settings');
    const [token, setToken] = useState('');

    if (state.hasToken) {
        return (
            <SettingsRow
                label={t('tunnels.token.label')}
                description={
                    state.account === null
                        ? t('tunnels.token.reachesAccounts', { count: state.zoneCount ?? 0, accounts: state.accounts.length })
                        : t('tunnels.token.reaches', { count: state.zones.length, account: state.account.name })
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
                <>
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
                        {t('tunnels.token.check')}
                    </Button>
                </>
            }
        />
    );
}

function StatusLine({ tone, children }: { tone: Tone; children: string }) {
    return (
        <span className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden className={clsx('size-1.5 shrink-0 rounded-full', DOT[tone])} />
            <span className="min-w-0 break-words">{children}</span>
        </span>
    );
}

/* The tunnel once it is linked, the reason it failed, or the choice of one while there is none. */
function TunnelRow({ state, endpointId, change }: { state: TunnelState; endpointId: string; change: TunnelChange }) {
    const { t } = useTranslation('settings');
    const [confirming, setConfirming] = useState(false);
    const { tunnel } = state;

    if (state.stage === 'checking') {
        return <SettingsRow label={t('tunnels.tunnel.label')} description={t('tunnels.stage.checking')} />;
    }

    if (state.stage === 'no-tunnel' || (tunnel === null && state.stage !== 'failed')) {
        return <PickTunnel state={state} endpointId={endpointId} change={change} />;
    }

    const status =
        state.stage === 'failed' ? (
            <StatusLine tone="error">{state.message ?? t('tunnels.stage.failed')}</StatusLine>
        ) : state.stage === 'starting' ? (
            <StatusLine tone="idle">{t('tunnels.stage.starting')}</StatusLine>
        ) : tunnel?.runner === 'ruimte' ? (
            <StatusLine tone="running">{t('tunnels.tunnel.runner.ruimte')}</StatusLine>
        ) : tunnel?.runner === 'other' ? (
            <StatusLine tone="running">{t('tunnels.tunnel.runner.other')}</StatusLine>
        ) : (
            <StatusLine tone="idle">{t('tunnels.tunnel.runner.none')}</StatusLine>
        );

    return (
        <>
            <SettingsRow
                label={t('tunnels.tunnel.label')}
                description={
                    <>
                        {tunnel !== null && <span className="block text-text">{tunnel.name}</span>}
                        {status}
                    </>
                }
                control={
                    <>
                        {state.stage === 'failed' && <Button onClick={() => void change('tunnel.retry')}>{t('tunnels.retry')}</Button>}
                        {tunnel !== null && <Button onClick={() => setConfirming(true)}>{t('tunnels.unlink.action')}</Button>}
                    </>
                }
            />
            {tunnel !== null && (
                <ConfirmDialog
                    open={confirming}
                    onOpenChange={setConfirming}
                    title={t('tunnels.unlink.title', { name: tunnel.name })}
                    description={t('tunnels.unlink.description')}
                    confirmLabel={t('tunnels.unlink.action')}
                    onConfirm={() => change('tunnel.unlink')}
                />
            )}
        </>
    );
}

/*
 * The account, then a tunnel already on it or a new one. Only a tunnel whose settings live in the Cloudflare dashboard can
 * take Ruimte's hostnames, so the list leaves the others out.
 */
function PickTunnel({ state, endpointId, change }: { state: TunnelState; endpointId: string; change: TunnelChange }) {
    const { t } = useTranslation('settings');
    const [picked, setPicked] = useState<string | null>(null);
    const [tunnels, setTunnels] = useState<TunnelExisting[]>([]);
    const [chosen, setChosen] = useState(NEW_TUNNEL);
    const [failure, setFailure] = useState<string | null>(null);
    const account = picked ?? state.account?.id ?? null;

    useEffect(() => {
        setTunnels([]);
        setChosen(NEW_TUNNEL);
        setFailure(null);

        if (account === null) {
            return;
        }

        transportFor(endpointId)
            ?.request('tunnel.list', { account })
            .then((found) => setTunnels(found.tunnels.filter((tunnel) => tunnel.usable)))
            .catch((e: unknown) => setFailure(messageOf(e, t('tunnels.tunnel.loadFailed'))));
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [endpointId, account]);

    const use = (): void => {
        if (account === null) {
            return;
        }

        void (chosen === NEW_TUNNEL ? change('tunnel.setup', { account }) : change('tunnel.link', { account, tunnel: chosen }));
    };

    return (
        <SettingsRow
            label={t('tunnels.tunnel.label')}
            description={failure ?? undefined}
            control={
                <>
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
                    <Select<string>
                        label={t('tunnels.tunnel.pick')}
                        variant="outlined"
                        value={chosen}
                        disabled={account === null}
                        items={[
                            { value: NEW_TUNNEL, label: t('tunnels.tunnel.new') },
                            ...tunnels.map((tunnel) => ({
                                value: tunnel.id,
                                label: tunnel.name,
                                description: t(tunnel.running ? 'tunnels.tunnel.running' : 'tunnels.tunnel.idle')
                            }))
                        ]}
                        onValueChange={setChosen}
                    />
                    <Button variant="primary" disabled={account === null} onClick={use}>
                        {t('tunnels.tunnel.use')}
                    </Button>
                </>
            }
        />
    );
}
