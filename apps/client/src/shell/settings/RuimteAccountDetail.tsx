import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Check, CircleAlert, KeyRound, Link2, LogOut, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PROVIDER_NAMES, type ProviderId } from '@ruimte/pulsar';
import { LinkMachineDialog } from '@/shell/LinkMachineDialog';
import { cancelPulsarSignIn, linkPulsarProvider, refreshPulsarIdentities, signOutOfPulsar, unlinkPulsarProvider, usePulsarAccount } from '@/pulsar/account';
import { PROVIDER_ORDER, identityDetail, signedInLabel, takeoverWarning } from '@/pulsar/account-name';
import { dismissAccountConfirmation, useAccountConfirmation } from '@/pulsar/confirmation';
import { PAIRING_PLACEHOLDER, usePairMachine } from '@/shell/settings/pair-machine';
import { Skeleton } from '@/shell/settings/controls';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { ProviderButton, SignInButtons } from '@/shell/SignInButtons';
import { Button } from '@ruimte/ui/Button';
import { FORM_ERROR } from '@ruimte/ui/classes';
import { Icon } from '@ruimte/ui/Icon';
import { SignInMark } from '@/ui/SignInMark';
import { Tooltip } from '@ruimte/ui/Tooltip';

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
            <Tooltip label={t('common:action.dismiss')} name>
                <button
                    className="icon-btn icon-btn-xs -my-0.5"
                    onClick={() => (failed ? usePulsarAccount.setState({ error: null }) : dismissAccountConfirmation())}
                >
                    <Icon icon={X} size={12} />
                </button>
            </Tooltip>
        </div>
    );
}

/* Signing in is what lets a client reach a machine it never paired with. The account vouches for this client's key. */
function SignInSection() {
    const { t } = useTranslation('settings');
    const status = usePulsarAccount((s) => s.status);
    const account = usePulsarAccount((s) => s.account);
    const identities = usePulsarAccount((s) => s.identities);
    const notice = usePulsarAccount((s) => s.notice);

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
                </>
            )}
        </SettingsSection>
    );
}

/* Pairing with a link from the other machine, or a code for one without the app. `focusAt` moves the focus to the link whenever it changes. */
function AddMachineSection({ focusAt }: { focusAt: number }) {
    const { t } = useTranslation('settings');
    const { link, setLink, failure, pair, canPair } = usePairMachine();
    const [linkOpen, setLinkOpen] = useState(false);
    const input = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (focusAt > 0) {
            input.current?.focus();
        }
    }, [focusAt]);

    return (
        <SettingsSection title={t('machines.add.title')} description={t('machines.add.description')}>
            <SettingsRow searchId="machines.add" label={t('machines.add.linkLabel')} description={t('machines.add.hint')}>
                <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                        <input
                            ref={input}
                            className="field min-w-0 grow font-mono text-code"
                            aria-label={t('machines.add.linkLabel')}
                            placeholder={PAIRING_PLACEHOLDER}
                            value={link}
                            spellCheck={false}
                            onChange={(e) => setLink(e.target.value)}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter' && canPair) {
                                    void pair();
                                }
                            }}
                        />
                        <Button variant="primary" disabled={!canPair} onClick={() => void pair()}>
                            <Icon icon={Link2} size={12} /> {t('machines.add.pair')}
                        </Button>
                    </div>
                    {failure && (
                        <p className={clsx(FORM_ERROR, 'break-words')} role="alert">
                            {failure}
                        </p>
                    )}
                    <Tooltip label={t('machines.add.codeHint')}>
                        <Button className="-ml-2 self-start" onClick={() => setLinkOpen(true)}>
                            <Icon icon={KeyRound} size={12} /> {t('machines.add.withCode')}
                        </Button>
                    </Tooltip>
                </div>
            </SettingsRow>
            <LinkMachineDialog nested open={linkOpen} initialCode={null} onOpenChange={setLinkOpen} />
        </SettingsSection>
    );
}

/* The Ruimte account of this client: how it signs in, and adding a machine to what it reaches. */
export function RuimteAccountDetail({ focusPairing }: { focusPairing: number }) {
    return (
        <>
            <SignInSection />
            <AddMachineSection focusAt={focusPairing} />
        </>
    );
}
