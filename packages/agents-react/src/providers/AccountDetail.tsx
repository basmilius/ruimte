import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { LogIn } from 'lucide-react';
import type { ProviderInfo } from '@ruimte/agent-contracts';
import { AccountDot } from '../agents/AccountDot';
import { accountName, FOLDER_VARIABLES, type AccountEntry } from '../agents/accounts';
import { ConfirmDialog } from '@ruimte/ui/settings/ConfirmDialog';
import { chatHost } from '../host';
import { useChatScope } from '../scope';
import { removeAccount, saveAccount } from './account-actions';
import { AccountVariables } from './AccountVariables';
import { AccountColors } from './AccountColors';
import { Toggle } from '@ruimte/ui/controls';
import { DetailHeader, REMOVE_BUTTON } from '@ruimte/ui/settings/DetailHeader';
import { CliMark } from './parts';
import { SettingsRow } from '@ruimte/ui/settings/SettingsRow';
import { SettingsSection } from '@ruimte/ui/settings/SettingsSection';
import { Button } from '@ruimte/ui/Button';
import { copyText } from '@ruimte/ui/clipboard';
import { Icon } from '@ruimte/ui/Icon';
import { Tooltip } from '@ruimte/ui/Tooltip';

// The states in which the machine's own sentence says more than the usual line under the login.
const TROUBLE = new Set(['folder-missing', 'unavailable', 'failed']);

interface AccountDetailProps {
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
export function AccountDetail({ provider, entry, canLogIn, loginBlocked, secretsAvailable, onRemoved }: AccountDetailProps) {
    const { t } = useTranslation('agent-providers');
    const scope = useChatScope();
    const [confirming, setConfirming] = useState(false);
    const { id, account, status, isDefault } = entry;
    const name = accountName(entry, provider.name);
    const folder = status?.home ?? '';
    const variable = FOLDER_VARIABLES[provider.kind];
    const signedIn = status?.state === 'ready';

    const showFolder = (): void => {
        copyText(folder);
        chatHost().notify({ kind: 'success', title: t('account.folderCopied'), description: folder });
    };

    const loginDetail = (): string => {
        if (status !== null && TROUBLE.has(status.state) && status.message) {
            return status.message;
        }
        if (!signedIn) {
            return t('account.login.signedOutDetail');
        }
        return status?.plan ? t('account.login.planDetail', { plan: status.plan }) : t('account.login.detail');
    };

    const loginButton = (
        <Button variant="secondary" disabled={loginBlocked !== null} onClick={() => void chatHost().openLogin?.(scope.id, provider.kind, id, name)}>
            <Icon icon={LogIn} size={14} />
            {signedIn ? t('account.login.logInAgain') : t('account.login.logIn')}
        </Button>
    );

    return (
        <>
            <DetailHeader
                mark={
                    <span className="grid h-6 shrink-0 place-items-center">
                        <AccountDot color={account.color} className="size-3" />
                    </span>
                }
                title={name}
                subtitle={
                    <>
                        <CliMark kind={provider.kind} size={12} className="text-text-muted" />
                        {t('account.kind', { provider: provider.name })}
                    </>
                }
                actions={
                    folder !== '' && (
                        <Button variant="secondary" onClick={showFolder}>
                            {t('account.showFolder')}
                        </Button>
                    )
                }
            />
            <SettingsSection>
                <SettingsRow
                    label={t('account.enabled.label')}
                    description={t('account.enabled.description')}
                    control={
                        <Toggle
                            checked={account.enabled !== false}
                            label={t('account.enabled.label')}
                            onChange={(checked) => {
                                const { enabled: _enabled, ...rest } = account;
                                void saveAccount(scope, id, checked ? rest : { ...rest, enabled: false });
                            }}
                        />
                    }
                />
                <SettingsRow
                    label={t('account.name')}
                    control={
                        <NameField key={name} value={name} label={t('account.name')} onSave={(label) => void saveAccount(scope, id, { ...account, label })} />
                    }
                />
                <SettingsRow
                    label={t('account.color')}
                    control={
                        <AccountColors
                            value={account.color}
                            label={t('account.color')}
                            onChange={(color) => void saveAccount(scope, id, { ...account, color })}
                        />
                    }
                />
            </SettingsSection>
            {canLogIn && (
                <SettingsSection title={t('account.login.title')}>
                    <SettingsRow
                        label={
                            signedIn
                                ? status?.email
                                    ? t('account.login.signedInAs', { email: status.email })
                                    : t('account.login.signedIn')
                                : t('account.login.signedOut')
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
                    <SettingsRow label={t('account.folder.label')}>
                        <input className="field h-8.5 font-mono text-code" value={folder} readOnly aria-label={t('account.folder.label')} />
                        <p className="-mt-1 text-xs text-text-muted">
                            {variable ? (
                                <Trans
                                    t={t}
                                    i18nKey="account.folder.detail"
                                    values={{ variable }}
                                    components={{ code: <code className="font-mono text-code" /> }}
                                />
                            ) : (
                                t('account.folder.detailPlain')
                            )}
                        </p>
                    </SettingsRow>
                </SettingsSection>
            )}
            <AccountVariables key={`${id}:${JSON.stringify(account.env ?? [])}`} id={id} account={account} secretsAvailable={secretsAvailable} />
            <SettingsSection>
                <SettingsRow
                    label={t('account.remove.label')}
                    description={isDefault ? t('account.remove.defaultNote') : t('account.remove.description')}
                    control={
                        <button type="button" className={REMOVE_BUTTON} disabled={isDefault} onClick={() => setConfirming(true)}>
                            {t('account.remove.button')}
                        </button>
                    }
                />
            </SettingsSection>
            <ConfirmDialog
                open={confirming}
                onOpenChange={setConfirming}
                title={t('account.remove.confirmTitle', { account: name })}
                description={t('account.remove.confirmDescription', { folder })}
                confirmLabel={t('account.remove.confirm')}
                onConfirm={async () => {
                    await removeAccount(scope, id, provider.kind);
                    onRemoved();
                }}
            />
        </>
    );
}
