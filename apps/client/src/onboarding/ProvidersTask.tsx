import { useState, type ReactNode } from 'react';
import { Laptop, LogIn, RefreshCw, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { accountStatusLine, ACCOUNT_TONE_CLASSES } from '@adecore/agents-react/agents/accounts';
import { CliMark } from '@adecore/agents-react/providers/parts';
import { useProviderAccountsStore } from '@adecore/agents-react/state/provider-accounts';
import { useProviders, useProvidersStore } from '@adecore/agents-react/state/providers';
import { joinNames, type CliRow } from '@/onboarding/tasks';
import { RowTile, TaskNote, TaskPane } from '@/onboarding/TaskPane';
import { useAppleFoundation } from '@/shell/settings/providers/use-apple-foundation';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { transportFor } from '@/transport';
import { SettingsRow, SettingsSection } from '@adecore/ui/settings';
import { Button, Icon, Pill, Switch } from '@adecore/ui';

interface ProvidersTaskProps {
    machine: string;
    rows: readonly CliRow[];
    missing: readonly string[];
    done: boolean;
    next: { label: string; go(): void };
}

/* Asks the machine for its CLIs and who is logged in again, for a CLI installed or logged in from outside Ruimte. */
async function checkAgain(): Promise<void> {
    const link = transportFor(LOCAL_ENDPOINT_ID);
    if (!link) {
        return;
    }
    const [{ providers }, accounts] = await Promise.all([
        link.request('provider.list', {}),
        // A machine from before accounts keeps none to ask about.
        link.request('accounts.refresh', {}).catch(() => null)
    ]);
    useProvidersStore.getState().setProviders(LOCAL_ENDPOINT_ID, providers);
    if (accounts !== null) {
        useProviderAccountsStore.getState().set(LOCAL_ENDPOINT_ID, accounts);
    }
}

/* The agent CLIs of this machine: who is logged in where, a login for the ones nobody is, and what is missing. */
export function ProvidersTask({ machine, rows, missing, done, next }: ProvidersTaskProps) {
    const { t } = useTranslation('onboarding');
    const loaded = useProviders((s) => s.loaded);
    const apple = useProviders((s) => s.providers.find((provider) => provider.kind === 'apple') ?? null);
    const mac = useServers((s) => s.byEndpoint[LOCAL_ENDPOINT_ID]?.platform === 'darwin');
    const [checking, setChecking] = useState(false);

    const recheck = async (): Promise<void> => {
        setChecking(true);
        try {
            await checkAgain();
        } catch {
            // What the list said stays on screen; the next press asks again.
        } finally {
            setChecking(false);
        }
    };

    return (
        <TaskPane
            icon={LogIn}
            title={t('tasks.providers.title')}
            subtitle={t('tasks.providers.header', { machine })}
            action={
                <Button disabled={checking} onClick={() => void recheck()}>
                    <Icon icon={RefreshCw} size={14} className={checking ? 'animate-spin' : undefined} /> {t('providers.checkAgain')}
                </Button>
            }
            footer={
                <>
                    <span className="grow text-xs text-text-faint">{done ? null : t('providers.doneWhen')}</span>
                    <Button variant="primary" onClick={next.go}>
                        {next.label}
                    </Button>
                </>
            }
        >
            <TaskNote>{t('providers.info')}</TaskNote>
            <SettingsSection>
                {!loaded && <SettingsRow label={t('providers.looking')} muted />}
                {loaded && rows.length === 0 && <SettingsRow label={t('providers.none')} muted />}
                {rows.map((row) => (
                    <CliLoginRow key={row.provider.kind} row={row} />
                ))}
                {mac && apple !== null && <AppleRow />}
                {missing.length > 0 && (
                    <SettingsRow
                        muted
                        leading={
                            <RowTile>
                                <Icon icon={Sparkles} size={16} className="text-text-faint" />
                            </RowTile>
                        }
                        label={joinNames(missing)}
                        description={<span className="text-text-faint">{t('providers.missing', { count: missing.length })}</span>}
                        control={<Pill shape="tag">{t('agent-providers:list.missing')}</Pill>}
                    />
                )}
            </SettingsSection>
        </TaskPane>
    );
}

/* One installed CLI: logged in and as whom, or why not and the login that fixes it. */
function CliLoginRow({ row }: { row: CliRow }) {
    const { t } = useTranslation('onboarding');
    const { provider, canLogIn, loggedIn, loginAccount } = row;
    const abilities = t(provider.capabilities.chat ? 'providers.chatAndTerminal' : 'providers.terminalOnly');
    const status = loginAccount?.status ?? null;

    let line: ReactNode;
    let control: ReactNode = null;
    if (loggedIn !== null) {
        const who = loggedIn.account.label ?? loggedIn.status?.email ?? null;
        line = [who, loggedIn.status?.plan ?? null, abilities].filter((part) => part !== null && part !== '').join(' · ');
        control = (
            <Pill shape="tag" tone="idle">
                {t('agent-providers:status.ready')}
            </Pill>
        );
    } else if (canLogIn && loginAccount !== null) {
        const { text, tone } = accountStatusLine(status, true);
        line = <span className={ACCOUNT_TONE_CLASSES[tone]}>{status?.state === 'signed-out' ? t('providers.notLoggedIn') : text}</span>;
        const account = loginAccount;
        control = (
            <Button
                variant="secondary"
                onClick={() =>
                    useUi.getState().setLogin({
                        endpointId: LOCAL_ENDPOINT_ID,
                        kind: provider.kind,
                        accountId: account.id,
                        name: account.account.label ?? provider.name
                    })
                }
            >
                <Icon icon={LogIn} size={14} /> {t('agent-providers:account.login.logIn')}
            </Button>
        );
    } else {
        line = abilities;
    }

    return (
        <SettingsRow
            leading={
                <RowTile>
                    <CliMark kind={provider.kind} size={16} />
                </RowTile>
            }
            label={
                <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate">{provider.name}</span>
                    {provider.version && <span className="shrink-0 font-mono text-code text-text-faint">{provider.version}</span>}
                </span>
            }
            description={line}
            control={control}
        />
    );
}

/* The model on this Mac, behind the same switch as in the settings. */
function AppleRow() {
    const { t } = useTranslation('onboarding');
    const provider = useProviders((s) => s.providers.find((entry) => entry.kind === 'apple') ?? null);
    const apple = useAppleFoundation(LOCAL_ENDPOINT_ID, provider);
    return (
        <SettingsRow
            leading={
                <RowTile>
                    <Icon icon={Laptop} size={16} className="text-text-muted" />
                </RowTile>
            }
            label="Apple Foundation Models"
            description={apple.enabled ? apple.status : t('providers.apple')}
            control={
                <Switch checked={apple.enabled} onCheckedChange={apple.setEnabled} label={t('settings:providers.apple.label')} disabled={!apple.switchable} />
            }
        />
    );
}
