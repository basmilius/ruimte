import { useState } from 'react';
import { CloudUpload, Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { forgetEndpoint } from '@/endpoint';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { messageOf, Button, Icon, FormError, Segmented } from '@adecore/ui';
import { ConfirmDialog, DetailHeader, SettingsRow, useSettingsTarget } from '@adecore/ui/settings';
import { usePulsarAccount, withAccessToken } from '@/pulsar/account';
import { useRegistrationFailures } from '@/pulsar/auto-register-watch';
import { addMachineToAccount, leaveAccount, openAccountMachine, refreshAccountMachines, usePulsarMachines } from '@/pulsar/machines';
import { BackgroundServiceSection } from '@/shell/settings/BackgroundServiceSection';
import { MachineIdentityForm } from '@/shell/settings/MachineIdentityForm';
import {
    BrokerRow,
    DirectRow,
    LanDoorRow,
    MachineAccess,
    MachineLinks,
    ReachRow,
    StreamingRow,
    UsageStatsRow,
    WithReason
} from '@/shell/settings/MachineSettings';
import { MachineStorage } from '@/shell/settings/MachineStorage';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useMachineIcon } from '@/shell/settings/machine-icon';
import { forgetOnClient, machineDialogModel, removeFromAccount, type MachineActionDeps, type MachineDialogModel } from '@/shell/settings/machine-actions';
import { nameOf, reachLabel, type MachineEntry } from '@/shell/settings/machine-list';
import { useServers } from '@/state/server';
import type { Endpoint } from '@/state/endpoints';
import { useToasts } from '@/state/toasts';
import { useEndpointConnection, useMachineHold } from '@/transport/status';

const ACTION_DEPS: MachineActionDeps = {
    forgetEndpoint,
    deleteFromAccount: (machineId) => withAccessToken((client, token) => client.deleteMachine(token, machineId)),
    refreshAccount: refreshAccountMachines
};

type MachineTab = 'overview' | 'connection' | 'storage' | 'access';

const MACHINE_TABS: readonly MachineTab[] = ['overview', 'connection', 'storage', 'access'];

const CONNECTION_TARGETS = ['machines.machine.broker', 'machines.machine.lanDoor', 'machines.machine.reach', 'machines.machine.direct'];

/* The tab that holds the row a search result names; every other row of a machine is on its overview. */
function tabOfTarget(target: string | null): MachineTab | null {
    if (target === null || !target.startsWith('machines.machine.')) {
        return null;
    }

    if (CONNECTION_TARGETS.includes(target)) {
        return 'connection';
    }

    return target.startsWith('machines.machine.storage.') ? 'storage' : 'overview';
}

/* Everything about one machine, beside its row in the Account pane, in a tab per part of it. */
export function MachineDetail({ entry }: { entry: MachineEntry }) {
    const { t } = useTranslation('settings');
    // The one place in the pane that connects to the machine, so its name, broker and clients with access are live.
    useMachineHold(entry.endpoint);
    const connection = useEndpointConnection(entry.endpoint?.id ?? entry.id);
    const signedIn = usePulsarAccount((s) => s.status === 'signed-in');
    const removedMachineIds = usePulsarMachines((s) => s.removedMachineIds);
    const info = useServers((s) => (entry.endpoint ? s.byEndpoint[entry.endpoint.id] : undefined));
    const icon = useMachineIcon(entry);
    // Only the app on this machine is told which account it is on.
    const machineAccount = entry.local ? info?.accountId : undefined;
    const model = machineDialogModel(entry, { connected: connection.status === 'open', signedIn, removedMachineIds, machineAccount });
    const reason = model.settings === 'not-answering' ? t('machineDialog.availableWhenAnswering') : null;
    const name = nameOf(entry);
    const version = info?.version ?? null;
    const { target } = useSettingsTarget();
    const [tab, setTab] = useState<MachineTab>(() => tabOfTarget(target) ?? 'overview');
    const [seenTarget, setSeenTarget] = useState(target);

    // A search result opens its own tab; adjusted while rendering so the row exists in the frame it is lit.
    if (target !== seenTarget) {
        setSeenTarget(target);
        const next = tabOfTarget(target);

        if (next !== null) {
            setTab(next);
        }
    }

    const open = (): void => {
        if (entry.machine === null) {
            return;
        }
        try {
            openAccountMachine(entry.machine);
        } catch (e) {
            showFailure(entry, t('machineDialog.openFailed', { machine: name }), e);
        }
    };

    return (
        <>
            <DetailHeader
                mark={
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-hover">
                        <MachineGlyph icon={icon} size={20} className="text-text-muted" />
                    </span>
                }
                title={name}
                subtitle={version === null ? reachLabel(entry) : t('machineDialog.subtitle', { reach: reachLabel(entry), version })}
            />
            {entry.endpoint === null && (
                <SettingsSection title={t('machineDialog.notOpened.title')}>
                    <SettingsRow
                        label={t('machineDialog.notOpened.label')}
                        description={model.canOpen ? t('machineDialog.notOpened.canOpen') : t('machineDialog.notOpened.noBroker')}
                        control={
                            <Button variant="secondary" disabled={!model.canOpen} onClick={open}>
                                <Icon icon={Plug} size={12} /> {t('common:action.open')}
                            </Button>
                        }
                    />
                </SettingsSection>
            )}
            {entry.endpoint === null ? (
                <RemoveSection entry={entry} model={model} />
            ) : (
                <>
                    <Segmented<MachineTab>
                        value={tab}
                        options={MACHINE_TABS.map((id) => ({ id, label: t(`machineDialog.tabs.${id}`) }))}
                        label={t('machineDialog.tabs.label')}
                        onValueChange={setTab}
                    />
                    {tab === 'overview' && (
                        <>
                            <MachineIdentityForm
                                key={`${info?.nameSource ?? ''}:${info?.label ?? ''}:${JSON.stringify(info?.icon ?? null)}:${reason ?? ''}`}
                                endpointId={entry.endpoint.id}
                                label={entry.endpoint.label}
                                disabledReason={reason}
                                knownIcon={icon}
                            />
                            <SettingsSection title={t('machineDialog.streaming')}>
                                <StreamingRow endpoint={entry.endpoint} reason={reason} />
                            </SettingsSection>
                            {entry.local && <BackgroundServiceSection />}
                            {entry.local && info?.usageStats !== undefined && (
                                <SettingsSection title={t('machineDialog.privacy')}>
                                    <UsageStatsRow endpoint={entry.endpoint} reason={reason} />
                                </SettingsSection>
                            )}
                            <MachineLinks endpoint={entry.endpoint} />
                        </>
                    )}
                    {tab === 'connection' && (
                        <SettingsSection title={t('machineDialog.connection')}>
                            <ReachRow endpoint={entry.endpoint} reason={reason} />
                            <LanDoorRow endpoint={entry.endpoint} reason={reason} />
                            <BrokerRow endpoint={entry.endpoint} reason={reason} />
                            {model.direct && <DirectRow endpoint={entry.endpoint} />}
                        </SettingsSection>
                    )}
                    {tab === 'storage' && <MachineStorage endpoint={entry.endpoint} />}
                    {tab === 'access' && (
                        <>
                            <MachineAccess endpoint={entry.endpoint} />
                            <AccountSection entry={entry} endpoint={entry.endpoint} model={model} machineAccount={machineAccount} reason={reason} />
                            <RemoveSection entry={entry} model={model} />
                        </>
                    )}
                </>
            )}
        </>
    );
}

function showFailure(entry: MachineEntry, title: string, e: unknown): void {
    useToasts.getState().show({ id: `machine-${entry.id}-${title}`, kind: 'error', title, description: messageOf(e) });
}

interface AccountSectionProps {
    entry: MachineEntry;
    endpoint: Endpoint;
    model: MachineDialogModel;
    machineAccount: string | null | undefined;
    reason: string | null;
}

/* Which account the machine is on, why it could not join, and the ways back onto it or off it. */
function AccountSection({ entry, endpoint, model, machineAccount, reason }: AccountSectionProps) {
    const { t } = useTranslation('settings');
    const signedInAccount = usePulsarAccount((s) => (s.status === 'signed-in' ? (s.account?.id ?? null) : null));
    const registrationFailure = useRegistrationFailures((s) => s.byMachine[endpoint.daemonId ?? entry.id] ?? null);
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const name = nameOf(entry);

    const addAgain = async (): Promise<void> => {
        setBusy(true);
        try {
            await addMachineToAccount(endpoint.id);
        } catch (e) {
            showFailure(entry, t('machineDialog.addFailed', { machine: name }), e);
        } finally {
            setBusy(false);
        }
    };

    const leave = async (): Promise<void> => {
        const revoked = await leaveAccount(endpoint.id, endpoint.daemonId ?? entry.id);
        useToasts.getState().show({
            id: `machine-${entry.id}-left`,
            kind: 'success',
            title: t('machineDialog.left.title', { machine: name }),
            ...(revoked === 0 ? {} : { description: t('machineDialog.left.revoked', { count: revoked }) })
        });
    };

    const accountState =
        typeof machineAccount === 'string'
            ? machineAccount === signedInAccount
                ? t('machineDialog.account.onYours')
                : t('machineDialog.account.onAnother')
            : machineAccount === null
              ? t('machineDialog.account.onNone')
              : null;

    if (registrationFailure === null && !model.canAddToAccountAgain && accountState === null) {
        return null;
    }
    return (
        <>
            <SettingsSection title={t('machineDialog.account.title')}>
                {accountState !== null && (
                    <SettingsRow
                        label={accountState}
                        description={model.canLeaveAccount ? t('machineDialog.account.leave.description') : undefined}
                        control={
                            model.canLeaveAccount ? (
                                <WithReason reason={reason}>
                                    <Button variant="danger-outline" disabled={reason !== null} onClick={() => setConfirming(true)}>
                                        {t('machineDialog.account.leave.action')}
                                    </Button>
                                </WithReason>
                            ) : undefined
                        }
                    />
                )}
                {registrationFailure && (
                    <FormError className="px-4.5 py-3 break-words">{t('machineDialog.account.registrationFailure', { reason: registrationFailure })}</FormError>
                )}
                {model.canAddToAccountAgain && (
                    <SettingsRow
                        label={t('machineDialog.account.addAgain.label')}
                        description={t('machineDialog.account.addAgain.description')}
                        control={
                            <WithReason reason={reason}>
                                <Button variant="secondary" disabled={busy || reason !== null} onClick={() => void addAgain()}>
                                    <Icon icon={CloudUpload} size={12} /> {t('machineDialog.account.addAgain.action')}
                                </Button>
                            </WithReason>
                        }
                    />
                )}
            </SettingsSection>
            <ConfirmDialog
                open={confirming}
                onOpenChange={setConfirming}
                title={t('machineDialog.confirmLeave.title', { machine: name })}
                description={t('machineDialog.confirmLeave.description')}
                confirmLabel={t('machineDialog.confirmLeave.action')}
                onConfirm={leave}
            />
        </>
    );
}

/* Forgetting the machine on this client, or taking it off the account. */
function RemoveSection({ entry, model }: { entry: MachineEntry; model: MachineDialogModel }) {
    const { t } = useTranslation('settings');
    const [confirming, setConfirming] = useState<'forget' | 'remove' | null>(null);
    const name = nameOf(entry);
    return (
        <>
            {(model.canForget || model.canRemoveFromAccount) && (
                <SettingsSection title={t('machineDialog.remove.title')}>
                    {model.canForget && (
                        <SettingsRow
                            label={t('machineDialog.remove.forget.label')}
                            description={t('machineDialog.remove.forget.description')}
                            control={
                                <Button variant="danger-outline" onClick={() => setConfirming('forget')}>
                                    {t('machineDialog.remove.forget.action')}
                                </Button>
                            }
                        />
                    )}
                    {model.canRemoveFromAccount && (
                        <SettingsRow
                            label={t('machineDialog.remove.account.label')}
                            description={entry.local ? t('machineDialog.remove.account.local') : t('machineDialog.remove.account.description')}
                            control={
                                <Button variant="danger-outline" onClick={() => setConfirming('remove')}>
                                    {t('machineDialog.remove.account.action')}
                                </Button>
                            }
                        />
                    )}
                </SettingsSection>
            )}
            <ConfirmDialog
                open={confirming === 'forget'}
                onOpenChange={(next) => setConfirming(next ? 'forget' : null)}
                title={t('machineDialog.confirmForget.title', { machine: name })}
                description={t('machineDialog.confirmForget.description')}
                confirmLabel={t('machineDialog.confirmForget.action')}
                onConfirm={() => forgetOnClient(entry, ACTION_DEPS)}
            />
            <ConfirmDialog
                open={confirming === 'remove'}
                onOpenChange={(next) => setConfirming(next ? 'remove' : null)}
                title={t('machineDialog.confirmRemove.title', { machine: name })}
                description={t('machineDialog.confirmRemove.description')}
                confirmLabel={t('machineDialog.confirmRemove.action')}
                onConfirm={() => removeFromAccount(entry, ACTION_DEPS)}
            />
        </>
    );
}
