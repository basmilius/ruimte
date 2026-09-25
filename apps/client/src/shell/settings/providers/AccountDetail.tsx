import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { LogIn } from 'lucide-react';
import type { ProviderInfo } from '@ruimte/contracts';
import { AccountDot } from '@/agents/AccountDot';
import { accountName, FOLDER_VARIABLES, type AccountEntry } from '@/agents/accounts';
import { ConfirmDialog } from '@/shell/settings/ConfirmDialog';
import { openLogin, removeAccount, saveAccount } from '@/shell/settings/providers/account-actions';
import { AccountVariables } from '@/shell/settings/providers/AccountVariables';
import { AccentSwatches } from '@/shell/settings/AccentSwatches';
import { Toggle } from '@/shell/settings/controls';
import { CliMark, DetailHeader, REMOVE_BUTTON } from '@/shell/settings/providers/parts';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useToasts } from '@/state/toasts';
import { Button } from '@/ui/Button';
import { copyText } from '@/ui/clipboard';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

// The states in which the machine's own sentence says more than the usual line under the login.
const TROUBLE = new Set(['folder-missing', 'unavailable', 'failed']);

interface AccountDetailProps {
    endpointId: string;
    provider: ProviderInfo;
    entry: AccountEntry;
    /* False for a CLI without a config folder: it has only its own login, and nothing to sign in here. */
    canLogIn: boolean;
    /* Why a login cannot open a terminal right now, or null when it can. */
    loginBlocked: string | null;
    secretsAvailable: boolean;
    onRemoved(): void;
}

/* The name a person types, saved when they leave the field; an empty one goes back to what was there. */
function NameField({ value, label, onSave }: { value: string; label: string; onSave(name: string): void }) {
    const [draft, setDraft] = useState(value);
    const commit = (): void => {
        const name = draft.trim();
        if (name === '' || name === value) {
            setDraft(value);
            return;
        }
        onSave(name);
    };
    return (
        <input
            className="field w-55 max-w-full"
            value={draft}
            maxLength={80}
            aria-label={label}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    event.currentTarget.blur();
                }
            }}
        />
    );
}

/* One account: how it looks in a picker, who is signed in, where its folder is, its variables. */
export function AccountDetail({ endpointId, provider, entry, canLogIn, loginBlocked, secretsAvailable, onRemoved }: AccountDetailProps) {
    const { t } = useTranslation('settings');
    const [confirming, setConfirming] = useState(false);
    const { id, account, status, isDefault } = entry;
    const name = accountName(entry, provider.name);
    const folder = status?.home ?? '';
    const variable = FOLDER_VARIABLES[provider.kind];
    const signedIn = status?.state === 'ready';

    const showFolder = (): void => {
        copyText(folder);
        useToasts.getState().show({ kind: 'success', title: t('providers.account.folderCopied'), description: folder });
    };

    const loginDetail = (): string => {
        if (status !== null && TROUBLE.has(status.state) && status.message) {
            return status.message;
        }
        if (!signedIn) {
            return t('providers.account.login.signedOutDetail');
        }
        return status?.plan ? t('providers.account.login.planDetail', { plan: status.plan }) : t('providers.account.login.detail');
    };

    const loginButton = (
        <Button variant="secondary" disabled={loginBlocked !== null} onClick={() => void openLogin(endpointId, provider.kind, id, name)}>
            <Icon icon={LogIn} size={14} />
            {signedIn ? t('providers.account.login.logInAgain') : t('providers.account.login.logIn')}
        </Button>
    );

    return (
        <>
            <DetailHeader
                mark={<AccountDot color={account.color} className="size-3" />}
                title={name}
                subtitle={
                    <>
                        <CliMark kind={provider.kind} size={12} className="text-text-muted" />
                        {t('providers.account.kind', { provider: provider.name })}
                    </>
                }
                actions={
                    folder !== '' && (
                        <Button variant="secondary" onClick={showFolder}>
                            {t('providers.account.showFolder')}
                        </Button>
                    )
                }
            />
            <SettingsSection>
                <SettingsRow
                    label={t('providers.account.enabled.label')}
                    description={t('providers.account.enabled.description')}
                    control={
                        <Toggle
                            checked={account.enabled !== false}
                            label={t('providers.account.enabled.label')}
                            onChange={(checked) => {
                                const { enabled: _enabled, ...rest } = account;
                                void saveAccount(endpointId, id, checked ? rest : { ...rest, enabled: false });
                            }}
                        />
                    }
                />
                <SettingsRow
                    label={t('providers.account.name')}
                    control={
                        <NameField
                            key={name}
                            value={name}
                            label={t('providers.account.name')}
                            onSave={(label) => void saveAccount(endpointId, id, { ...account, label })}
                        />
                    }
                />
                <SettingsRow
                    label={t('providers.account.color')}
                    control={
                        <AccentSwatches
                            value={account.color}
                            label={t('providers.account.color')}
                            onChange={(color) => void saveAccount(endpointId, id, { ...account, color })}
                        />
                    }
                />
            </SettingsSection>
            {canLogIn && (
                <SettingsSection title={t('providers.account.login.title')}>
                    <SettingsRow
                        label={
                            signedIn
                                ? status?.email
                                    ? t('providers.account.login.signedInAs', { email: status.email })
                                    : t('providers.account.login.signedIn')
                                : t('providers.account.login.signedOut')
                        }
                        description={loginBlocked === null ? loginDetail() : `${loginDetail()} ${loginBlocked}`}
                        control={
                            loginBlocked === null ? (
                                loginButton
                            ) : (
                                <Tooltip label={loginBlocked}>
                                    <span className="inline-flex">{loginButton}</span>
                                </Tooltip>
                            )
                        }
                    />
                    <SettingsRow label={t('providers.account.folder.label')}>
                        <input className="field h-8.5 font-mono text-code" value={folder} readOnly aria-label={t('providers.account.folder.label')} />
                        <p className="-mt-1 text-xs text-text-muted">
                            {variable ? (
                                <Trans
                                    t={t}
                                    i18nKey="providers.account.folder.detail"
                                    values={{ variable }}
                                    components={{ code: <code className="font-mono text-code" /> }}
                                />
                            ) : (
                                t('providers.account.folder.detailPlain')
                            )}
                        </p>
                    </SettingsRow>
                </SettingsSection>
            )}
            <AccountVariables
                key={`${id}:${JSON.stringify(account.env ?? [])}`}
                endpointId={endpointId}
                id={id}
                account={account}
                secretsAvailable={secretsAvailable}
            />
            <SettingsSection>
                <SettingsRow
                    label={t('providers.account.remove.label')}
                    description={isDefault ? t('providers.account.remove.defaultNote') : t('providers.account.remove.description')}
                    control={
                        <button type="button" className={REMOVE_BUTTON} disabled={isDefault} onClick={() => setConfirming(true)}>
                            {t('providers.account.remove.button')}
                        </button>
                    }
                />
            </SettingsSection>
            <ConfirmDialog
                open={confirming}
                onOpenChange={setConfirming}
                title={t('providers.account.remove.confirmTitle', { account: name })}
                description={t('providers.account.remove.confirmDescription', { folder })}
                confirmLabel={t('providers.account.remove.confirm')}
                onConfirm={async () => {
                    await removeAccount(endpointId, id, provider.kind);
                    onRemoved();
                }}
            />
        </>
    );
}
