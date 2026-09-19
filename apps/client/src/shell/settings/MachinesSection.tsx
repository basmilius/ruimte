import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import { Check, ChevronRight, CircleAlert, KeyRound, Link2, LogOut, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PROVIDER_NAMES, type ProviderId } from '@ruimte/pulsar';
import { LinkMachineDialog } from '@/shell/LinkMachineDialog';
import { pairEndpoint } from '@/endpoint';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import {
    cancelPulsarSignIn,
    linkPulsarProvider,
    messageOf,
    refreshPulsarIdentities,
    signOutOfPulsar,
    unlinkPulsarProvider,
    usePulsarAccount
} from '@/pulsar/account';
import { PROVIDER_ORDER, identityDetail, signedInLabel, takeoverWarning } from '@/pulsar/account-name';
import { dismissAccountConfirmation, useAccountConfirmation } from '@/pulsar/confirmation';
import { forgetAccountMachines, reclaimAfterPairing, refreshAccountMachines, usePulsarMachines } from '@/pulsar/machines';
import { describeConnection, describeLastSeen, describePing, reachabilityLabel } from '@/shell/connection-info';
import { MachineDialog } from '@/shell/settings/MachineDialog';
import { ProviderButton, SignInButtons } from '@/shell/SignInButtons';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Skeleton } from '@/shell/settings/controls';
import { useMachineIcon } from '@/shell/settings/machine-icon';
import { mergeMachines, nameOf, reachLabel, type MachineEntry } from '@/shell/settings/machine-list';
import { brokerRouteOf, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { useToasts } from '@/state/toasts';
import { hasLocalMachine } from '@/state/local-machine';
import type { TransportStatus } from '@/transport';
import { useMinute } from '@/shell/usage/limits';
import { useLatency } from '@/transport/ping';
import { useEndpointConnection, useLastSeenAt } from '@/transport/status';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { SignInMark } from '@/ui/SignInMark';
import { Tooltip } from '@/ui/Tooltip';

const DOT: Record<TransportStatus, string> = {
    open: 'bg-status-idle',
    connecting: 'bg-status-needs-you',
    closed: 'bg-status-error'
};

/*
 * The whole of a row's connection in one dot: whether the machine answers, and behind it the things
 * that only matter when it does not. The address sits in this tooltip because it is a hint about
 * where a machine last answered, not what the machine is.
 */
function ConnectionDot({ endpoint }: { endpoint: Endpoint }) {
    const { t } = useTranslation('settings');
    const connection = useEndpointConnection(endpoint.id);
    const latency = useLatency(endpoint.id);
    const lastSeenAt = useLastSeenAt(endpoint.id);
    const reachability = useServers((s) => s.byEndpoint[endpoint.id]?.reachability ?? endpoint.reachability);
    const now = useMinute();
    const lastSeen = connection.noLink === true ? describeLastSeen(lastSeenAt, now) : null;

    const tooltip = (
        <span className="flex flex-col items-start gap-0.5">
            <span>{describeConnection(connection, null)}</span>
            {lastSeen !== null && <span className="text-text-muted">{lastSeen}</span>}
            <span className="text-text-muted">{reachabilityLabel(reachability)}</span>
            <span className="font-mono text-text-muted">{endpoint.httpBaseUrl === '' ? t('machines.dot.brokerOnly') : endpoint.httpBaseUrl}</span>
            {endpoint.direct === true && (
                <span className="text-text-muted">{brokerRouteOf(endpoint) === null ? t('machines.dot.direct') : t('machines.dot.directBroker')}</span>
            )}
            <span className="text-text-muted">{describePing(latency)}</span>
        </span>
    );

    return (
        <Tooltip label={tooltip}>
            <span
                className="grid h-8 w-6 shrink-0 place-items-center"
                role="status"
                aria-label={t('machines.dot.aria', { machine: endpoint.label, status: describeConnection(connection, null) })}
            >
                <span className={clsx('h-2 w-2 rounded-full', connection.noLink === true ? 'border border-border-strong' : DOT[connection.status])} />
            </span>
        </Tooltip>
    );
}

/* A machine only the account knows has no connection here, which a hollow dot says without a color. */
function NotOpenedDot({ name }: { name: string }) {
    const { t } = useTranslation('settings');
    return (
        <Tooltip label={t('machines.notOpened')}>
            <span className="grid h-8 w-6 shrink-0 place-items-center" role="status" aria-label={t('machines.notOpenedAria', { machine: name })}>
                <span className="h-2 w-2 rounded-full border border-border-strong" />
            </span>
        </Tooltip>
    );
}

/* Why this client cannot reach the machine the way it should, for the line under the name. */
const useRowFailure = (endpoint: Endpoint | null): string | null => {
    const { t } = useTranslation('settings');
    const mismatch = useEndpoints((s) => (endpoint ? s.mismatched[endpoint.id] : undefined));
    const connection = useEndpointConnection(endpoint?.id ?? '');
    if (endpoint === null) {
        return null;
    }
    if (mismatch !== undefined) {
        return t('machines.mismatch');
    }
    // A socket reports a failure only for a refusal (another wire version), so any failure is worth the line.
    return connection.status !== 'open' ? (connection.failure ?? null) : null;
};

function MachineRow({ entry, onOpen }: { entry: MachineEntry; onOpen(): void }) {
    const { t } = useTranslation('settings');
    const icon = useMachineIcon(entry);
    const failure = useRowFailure(entry.endpoint);
    const relayed = useEndpointConnection(entry.endpoint?.id ?? '').relayed === true;
    const name = nameOf(entry);

    return (
        <div className="flex min-w-0 items-center gap-1 py-1 pr-3 pl-1.5">
            <button
                type="button"
                className="flex min-w-0 grow items-center gap-3 rounded-lg px-2.5 py-1.5 text-left outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={t('machines.rowAria', { machine: name, reach: reachLabel(entry) })}
                onClick={onOpen}
            >
                <MachineGlyph icon={icon} className="shrink-0 text-text-muted" />
                <span className="flex min-w-0 grow flex-col">
                    <span className="truncate text-sm text-text">{name}</span>
                    <span className="text-xs leading-snug break-words text-text-faint">
                        {relayed ? t('machines.viaRelay', { reach: reachLabel(entry) }) : reachLabel(entry)}
                    </span>
                    {failure !== null && <span className="text-xs leading-snug break-words text-status-error">{failure}</span>}
                </span>
                <Icon icon={ChevronRight} size={16} className="shrink-0 text-text-faint" />
            </button>
            {entry.endpoint ? <ConnectionDot endpoint={entry.endpoint} /> : <NotOpenedDot name={name} />}
        </div>
    );
}

/* One way to sign in to the account: remove it while another remains, or add it when the address book offers it. */
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
                control={last ? undefined : <Button onClick={() => void unlinkPulsarProvider(provider)}>{t('common:action.remove')}</Button>}
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
        <div className="flex min-w-0 items-start gap-2 px-4 py-2.5" role={failed ? 'alert' : 'status'} aria-live="polite">
            <span className="grid h-(--text-sm--line-height) w-4 shrink-0 place-items-center">
                <Icon icon={failed ? CircleAlert : Check} size={16} className={failed ? 'text-status-error' : 'text-status-idle'} />
            </span>
            <span className={clsx('min-w-0 grow text-sm break-words', failed ? 'text-status-error' : 'text-text')}>{text}</span>
            <Tooltip label={t('common:action.dismiss')} name>
                <button
                    className="icon-btn -my-0.5 h-6 w-6 shrink-0"
                    onClick={() => (failed ? usePulsarAccount.setState({ error: null }) : dismissAccountConfirmation())}
                >
                    <Icon icon={X} size={12} />
                </button>
            </Tooltip>
        </div>
    );
}

/* Signing in is what lets a client reach a machine it never paired with: the account vouches for this client's key. */
function AccountRows() {
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
        <>
            <AccountOutcome />
            {status === 'unavailable' && (
                <SettingsRow muted label={t('machines.account.unavailable.label')} description={t('machines.account.unavailable.description')} />
            )}
            {status === 'loading' && <SettingsRow label={<Skeleton className="w-40" />} control={<Skeleton className="w-20" />} />}
            {status === 'signed-out' && (
                <SettingsRow
                    label={t('machines.account.signedOut.label')}
                    description={notice ?? t('machines.account.signedOut.description')}
                    control={<SignInButtons className="justify-end" confirm />}
                />
            )}
            {status === 'signing-in' && (
                <SettingsRow
                    label={t('machines.account.signingIn.label')}
                    description={t('machines.account.signingIn.description')}
                    control={<Button onClick={() => void cancelPulsarSignIn()}>{t('common:action.cancel')}</Button>}
                />
            )}
            {status === 'signed-in' && account && (
                <>
                    <SettingsRow
                        label={signedInLabel(account)}
                        description={takeoverWarning(identities?.map((identity) => identity.provider) ?? [account.provider])}
                        control={
                            <Button onClick={() => void signOutOfPulsar()}>
                                <Icon icon={LogOut} size={12} /> {t('machines.account.signOut')}
                            </Button>
                        }
                    />
                    {identities !== null && PROVIDER_ORDER.map((provider) => <IdentityRow key={provider} provider={provider} />)}
                </>
            )}
        </>
    );
}

/*
 * Adding a machine, in a dialog rather than a field that is always on screen: pairing happens once
 * per machine and the list is what the pane is for. The dialog is about "a machine" rather than "a
 * pairing link", which leaves room for a second way in (a code for a phone) without renaming anything.
 */
export function AddMachineDialog({
    open,
    onOpenChange,
    onLinkWithCode,
    nested = true
}: {
    open: boolean;
    onOpenChange(open: boolean): void;
    onLinkWithCode(): void;
    /* Over the settings, which is where it usually opens; the start screen opens it on its own. */
    nested?: boolean;
}) {
    const { t } = useTranslation('settings');
    const [link, setLink] = useState('');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    const pair = async (): Promise<void> => {
        setBusy(true);
        setFailure(null);
        try {
            const record = await pairEndpoint(link);
            setLink('');
            onOpenChange(false);
            reclaimAfterPairing(record).catch((e: unknown) => {
                useToasts.getState().show({
                    id: `machine-reclaim-${record.id}`,
                    kind: 'error',
                    title: t('machines.add.reclaimFailed', { machine: record.label }),
                    description: messageOf(e)
                });
            });
        } catch (e) {
            setFailure(e instanceof Error ? e.message : t('machines.add.failed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Backdrop className={clsx('dialog-backdrop', nested && 'dialog-backdrop-nested')} forceRender />
                <Dialog.Popup className={clsx('dialog-popup w-[460px] p-5', nested && 'dialog-popup-nested')}>
                    <Dialog.Title className="text-base font-semibold text-text">{t('machines.add.title')}</Dialog.Title>
                    <Dialog.Description className="mt-1 text-xs text-text-muted">{t('machines.add.description')}</Dialog.Description>
                    <input
                        autoFocus
                        className="field mt-3 min-w-0 font-mono text-code"
                        aria-label={t('machines.add.linkLabel')}
                        placeholder="http://machine:4210/pair#token"
                        value={link}
                        spellCheck={false}
                        onChange={(e) => setLink(e.target.value)}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter' && link.trim()) {
                                void pair();
                            }
                        }}
                    />
                    <p className="mt-1.5 text-xs break-words text-text-faint">{t('machines.add.hint')}</p>
                    {failure && (
                        <p className="mt-2 text-xs break-words text-status-error" role="alert">
                            {failure}
                        </p>
                    )}
                    <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                        <Tooltip label={t('machines.add.codeHint')}>
                            <Button className="mr-auto" onClick={onLinkWithCode}>
                                <Icon icon={KeyRound} size={12} /> {t('machines.add.withCode')}
                            </Button>
                        </Tooltip>
                        <Button onClick={() => onOpenChange(false)}>{t('common:action.cancel')}</Button>
                        <Button variant="primary" disabled={busy || !link.trim()} onClick={() => void pair()}>
                            <Icon icon={Link2} size={12} /> {t('machines.add.pair')}
                        </Button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/*
 * One list of machines: the rows of this client (this machine, and every machine paired by link)
 * joined with the machines on the account, one entry per machine id. Everything that can be done to
 * a machine lives in its dialog, so the list stays a list of machines rather than of controls.
 */
export function MachinesSection() {
    const { t } = useTranslation('settings');
    const endpoints = useEndpoints((s) => s.endpoints);
    const status = usePulsarAccount((s) => s.status);
    const machines = usePulsarMachines((s) => s.machines);
    const machinesError = usePulsarMachines((s) => s.error);
    const [addOpen, setAddOpen] = useState(false);
    const [linkOpen, setLinkOpen] = useState(false);
    const [dialog, setDialog] = useState<{ id: string; open: boolean } | null>(null);

    // An open pane is one of the moments a client learns what the account says, removals included.
    useEffect(() => {
        if (status === 'signed-in') {
            void refreshAccountMachines();
        } else if (status === 'signed-out') {
            forgetAccountMachines();
        }
    }, [status]);

    const signedIn = status === 'signed-in';
    const entries = mergeMachines({ endpoints, accountMachines: signedIn ? machines : null, showLocal: hasLocalMachine() });
    const selected = dialog === null ? null : (entries.find((entry) => entry.id === dialog.id) ?? null);

    return (
        <>
            <SettingsSection title={t('machines.account.title')} description={t('machines.account.description')}>
                <AccountRows />
            </SettingsSection>
            <SettingsSection
                title={t('machines.title')}
                description={t('machines.description')}
                action={
                    <Button variant="secondary" onClick={() => setAddOpen(true)}>
                        <Icon icon={Plus} size={12} /> {t('machines.add.title')}
                    </Button>
                }
            >
                {entries.length === 0 && <SettingsRow muted label={t('machines.empty.label')} description={t('machines.empty.description')} />}
                {entries.map((entry) => (
                    <MachineRow key={entry.id} entry={entry} onOpen={() => setDialog({ id: entry.id, open: true })} />
                ))}
                {signedIn && machines === null && machinesError === null && (
                    <SettingsRow label={<Skeleton className="w-40" />} description={<Skeleton className="mt-1 w-24" />} />
                )}
                {signedIn && machinesError !== null && <SettingsRow muted label={<span className="break-words text-status-error">{machinesError}</span>} />}
            </SettingsSection>
            <MachineDialog
                entry={selected}
                open={dialog?.open === true}
                onOpenChange={(open) => setDialog((current) => (current ? { ...current, open } : null))}
            />
            <AddMachineDialog
                open={addOpen}
                onOpenChange={setAddOpen}
                onLinkWithCode={() => {
                    setAddOpen(false);
                    setLinkOpen(true);
                }}
            />
            <LinkMachineDialog nested open={linkOpen} initialCode={null} onOpenChange={setLinkOpen} />
        </>
    );
}
