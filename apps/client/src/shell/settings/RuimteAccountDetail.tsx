import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Check, CircleAlert, KeyRound, LogOut, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PROVIDER_NAMES, type ProviderId } from '@ruimte/pulsar';
import { LinkMachineDialog } from '@/shell/LinkMachineDialog';
import { DeleteAccountDialog } from '@/shell/settings/DeleteAccountDialog';
import { cancelPulsarSignIn, linkPulsarProvider, refreshPulsarIdentities, signOutOfPulsar, unlinkPulsarProvider, usePulsarAccount } from '@/pulsar/account';
import { PROVIDER_ORDER, identityDetail, signedInLabel, takeoverWarning } from '@/pulsar/account-name';
import { dismissAccountConfirmation, useAccountConfirmation } from '@/pulsar/confirmation';
import { Skeleton, Button, Icon, IconButton } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { ProviderButton, SignInButtons } from '@/shell/SignInButtons';
import { SignInMark } from '@/ui/SignInMark';

/* One way to sign in to the account. Remove it while another remains, or add it when the address book offers it. */
function IdentityRow({ provider }: { provider: ProviderId }) {
    const { t } = useTranslation('settings');
    const identities = usePulsarAccount((s) => s.identities);
    const linking = usePulsarAccount((s) => s.linking);
    const offered = usePulsarAccount((s) => s.providers.includes(provider));
    const identity = identities?.find((entry) => entry.provider === provider) ?? null;
    const name = PROVIDER_NAMES[provider];
    const label = (
        <span className="flex items-center gap-2">
            <SignInMark provider={provider} size={14} /> {name}
        </span>
    );

    if (identity !== null) {
        const last = identities?.length === 1;
        return (
            <SettingsRow
                label={label}
                description={last ? t('machines.account.onlyIdentity', { detail: identityDetail(identity) }) : identityDetail(identity)}
                control={
                    last ? undefined : (
                        <Button variant="secondary" onClick={() => void unlinkPulsarProvider(provider)}>
                            {t('common:action.remove')}
                        </Button>
                    )
                }
            />
        );
    }
    if (!offered) {
        return null;
    }
    if (linking === provider) {
        return (
            <SettingsRow
                label={label}
                description={t('machines.account.finishWith', { provider: name })}
                control={<Button onClick={() => void cancelPulsarSignIn()}>{t('common:action.cancel')}</Button>}
            />
        );
    }
    return (
        <SettingsRow
            muted
            label={label}
            description={t('machines.account.notAdded', { provider: name })}
            control={<ProviderButton provider={provider} verb="Continue" disabled={linking !== null} onClick={() => void linkPulsarProvider(provider)} />}
        />
    );
}

/*
 * How the last sign-in or added provider went, first in the section it came back to. A success and a
 * failure alike stay until they are dismissed or the next attempt starts.
 */
function AccountOutcome() {
    const { t } = useTranslation('settings');
    const confirmation = useAccountConfirmation((s) => s.text);
    const error = usePulsarAccount((s) => s.error);
    const text = confirmation ?? error;
    if (text === null) {
        return null;
    }
    const failed = confirmation === null;
    return (
        <div className="flex min-w-0 items-start gap-2 px-4.5 py-2.5" role={failed ? 'alert' : 'status'} aria-live="polite">
            <span className="grid h-(--text-sm--line-height) w-4 shrink-0 place-items-center">
                <Icon icon={failed ? CircleAlert : Check} size={16} className={failed ? 'text-status-error' : 'text-status-idle'} />
            </span>
            <span className={clsx('min-w-0 grow text-sm break-words', failed ? 'text-status-error' : 'text-text')}>{text}</span>
            <IconButton
                icon={X}
                size="xs"
                label={t('common:action.dismiss')}
                className="-my-0.5"
                onClick={() => (failed ? usePulsarAccount.setState({ error: null }) : dismissAccountConfirmation())}
            />
        </div>
    );
}

/* Signing in is what lets a client reach a machine at all. The account vouches for this client's key. */
function SignInSection() {
    const { t } = useTranslation('settings');
    const status = usePulsarAccount((s) => s.status);
    const account = usePulsarAccount((s) => s.account);
    const identities = usePulsarAccount((s) => s.identities);
    const notice = usePulsarAccount((s) => s.notice);
    const [deleting, setDeleting] = useState(false);

    // An open pane asks which identities the account has, since another client may have added or removed one.
    useEffect(() => {
        if (status === 'signed-in') {
            void refreshPulsarIdentities();
        }
    }, [status]);

    return (
        <SettingsSection title={t('machines.account.title')} description={t('machines.account.description')}>
            <AccountOutcome />
            {status === 'unavailable' && (
                <SettingsRow
                    muted
                    searchId="machines.signIn"
                    label={t('machines.account.unavailable.label')}
                    description={t('machines.account.unavailable.description')}
                />
            )}
            {status === 'loading' && <SettingsRow searchId="machines.signIn" label={<Skeleton className="w-40" />} control={<Skeleton className="w-20" />} />}
            {status === 'signed-out' && (
                <SettingsRow
                    searchId="machines.signIn"
                    label={t('machines.account.signedOut.label')}
                    description={notice ?? t('machines.account.signedOut.description')}
                    control={<SignInButtons className="justify-end" confirm />}
                />
            )}
            {status === 'signing-in' && (
                <SettingsRow
                    searchId="machines.signIn"
                    label={t('machines.account.signingIn.label')}
                    description={t('machines.account.signingIn.description')}
                    control={<Button onClick={() => void cancelPulsarSignIn()}>{t('common:action.cancel')}</Button>}
                />
            )}
            {status === 'signed-in' && account && (
                <>
                    <SettingsRow
                        searchId="machines.signIn"
                        label={signedInLabel(account)}
                        description={takeoverWarning(identities?.map((identity) => identity.provider) ?? [account.provider])}
                        control={
                            <Button variant="secondary" onClick={() => void signOutOfPulsar()}>
                                <Icon icon={LogOut} size={12} /> {t('machines.account.signOut')}
                            </Button>
                        }
                    />
                    {identities !== null && PROVIDER_ORDER.map((provider) => <IdentityRow key={provider} provider={provider} />)}
                    <SettingsRow
                        label={t('machines.account.delete.label')}
                        description={t('machines.account.delete.description')}
                        control={
                            <Button variant="danger-outline" onClick={() => setDeleting(true)}>
                                {t('machines.account.delete.action')}
                            </Button>
                        }
                    />
                    <DeleteAccountDialog account={account} open={deleting} onOpenChange={setDeleting} />
                </>
            )}
        </SettingsSection>
    );
}

/* How a machine joins the account, from that machine, or with the code of a machine that ran `ruimte login`. */
function AddMachineSection() {
    const { t } = useTranslation('settings');
    const [linkOpen, setLinkOpen] = useState(false);

    return (
        <SettingsSection title={t('machines.add.title')} description={t('machines.add.description')}>
            <SettingsRow
                searchId="machines.add"
                label={t('machines.add.withCode')}
                description={t('machines.add.codeHint')}
                control={
                    <Button onClick={() => setLinkOpen(true)}>
                        <Icon icon={KeyRound} size={12} /> {t('machines.add.enterCode')}
                    </Button>
                }
            />
            <LinkMachineDialog nested open={linkOpen} initialCode={null} onOpenChange={setLinkOpen} />
        </SettingsSection>
    );
}

/* The Ruimte account of this client: how it signs in, and how a machine joins what it reaches. */
export function RuimteAccountDetail() {
    return (
        <>
            <SignInSection />
            <AddMachineSection />
        </>
    );
}
