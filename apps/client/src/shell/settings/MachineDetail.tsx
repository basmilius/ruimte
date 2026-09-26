import { useState } from 'react';
import { CloudUpload, Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { forgetEndpoint } from '@/endpoint';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { messageOf } from '@ruimte/ui/error-message';
import { usePulsarAccount, withAccessToken } from '@/pulsar/account';
import { useRegistrationFailures } from '@/pulsar/auto-register-watch';
import { addMachineToAccount, openAccountMachine, refreshAccountMachines, usePulsarMachines } from '@/pulsar/machines';
import { BackgroundServiceSection } from '@/shell/settings/BackgroundServiceSection';
import { ConfirmDialog } from '@/shell/settings/ConfirmDialog';
import { MachineIdentityForm } from '@/shell/settings/MachineIdentityForm';
import { BrokerRow, DirectRow, MachineAccess, RefuseStatementsRow, StreamingRow, WithReason } from '@/shell/settings/MachineSettings';
import { DetailHeader, REMOVE_BUTTON } from '@/shell/settings/providers/parts';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useMachineIcon } from '@/shell/settings/machine-icon';
import { forgetOnClient, machineDialogModel, removeFromAccount, type MachineActionDeps } from '@/shell/settings/machine-actions';
import { nameOf, reachLabel, type MachineEntry } from '@/shell/settings/machine-list';
import { useServers } from '@/state/server';
import { useToasts } from '@/state/toasts';
import { useEndpointConnection, useMachineHold } from '@/transport/status';
import { Button } from '@ruimte/ui/Button';
import { FORM_ERROR } from '@ruimte/ui/classes';
import { Icon } from '@ruimte/ui/Icon';

const ACTION_DEPS: MachineActionDeps = {
    forgetEndpoint,
    deleteFromAccount: (machineId) => withAccessToken((client, token) => client.deleteMachine(token, machineId)),
    refreshAccount: refreshAccountMachines
};

type Confirming = 'forget' | 'remove' | null;

/* Everything about one machine, beside its row in the Account pane. */
export function MachineDetail({ entry }: { entry: MachineEntry }) {
    const { t } = useTranslation('settings');
    // The detail is a person looking at this machine, the one place in the pane that connects to it. Its name, broker and paired clients are live.
    useMachineHold(entry.endpoint);
    const connection = useEndpointConnection(entry.endpoint?.id ?? entry.id);
    const signedIn = usePulsarAccount((s) => s.status === 'signed-in');
    const removedMachineIds = usePulsarMachines((s) => s.removedMachineIds);
    const info = useServers((s) => (entry.endpoint ? s.byEndpoint[entry.endpoint.id] : undefined));
    const icon = useMachineIcon(entry);
    const registrationFailure = useRegistrationFailures((s) => s.byMachine[entry.endpoint?.daemonId ?? entry.id] ?? null);
    const [confirming, setConfirming] = useState<Confirming>(null);
    const [busy, setBusy] = useState(false);
    const model = machineDialogModel(entry, { connected: connection.status === 'open', signedIn, removedMachineIds });
    const reason = model.settings === 'not-answering' ? t('machineDialog.availableWhenAnswering') : null;
    const name = nameOf(entry);
    const version = info?.version ?? null;

    const failed = (title: string, e: unknown): void => {
        useToasts.getState().show({ id: `machine-${entry.id}-${title}`, kind: 'error', title, description: messageOf(e) });
    };

    const open = (): void => {
        if (entry.machine === null) {
            return;
        }
        try {
            openAccountMachine(entry.machine);
        } catch (e) {
            failed(t('machineDialog.openFailed', { machine: name }), e);
        }
    };

    const addAgain = async (): Promise<void> => {
        if (entry.endpoint === null) {
            return;
        }
        setBusy(true);
        try {
            await addMachineToAccount(entry.endpoint.id);
        } catch (e) {
            failed(t('machineDialog.addFailed', { machine: name }), e);
        } finally {
            setBusy(false);
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
            {entry.endpoint !== null && (
                <>
                    <MachineIdentityForm
                        key={`${info?.nameSource ?? ''}:${info?.label ?? ''}:${JSON.stringify(info?.icon ?? null)}`}
                        endpointId={entry.endpoint.id}
                        label={entry.endpoint.label}
                        disabledReason={reason}
                    />
                    <SettingsSection title={t('machineDialog.connection')}>
                        <BrokerRow endpoint={entry.endpoint} reason={reason} />
                        <DirectRow endpoint={entry.endpoint} available={model.direct} />
                        <RefuseStatementsRow endpoint={entry.endpoint} reason={reason} />
                        <StreamingRow endpoint={entry.endpoint} reason={reason} />
                    </SettingsSection>
                    {(registrationFailure !== null || model.canAddToAccountAgain) && (
                        <SettingsSection title={t('machineDialog.account.title')}>
                            {registrationFailure && (
                                <p className={`${FORM_ERROR} px-4.5 py-3 break-words`} role="alert">
                                    {t('machineDialog.account.registrationFailure', { reason: registrationFailure })}
                                </p>
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
                    )}
                    {entry.local && <BackgroundServiceSection />}
                    <MachineAccess endpoint={entry.endpoint} />
                </>
            )}
            {(model.canForget || model.canRemoveFromAccount) && (
                <SettingsSection title={t('machineDialog.remove.title')}>
                    {model.canForget && (
                        <SettingsRow
                            label={t('machineDialog.remove.forget.label')}
                            description={t('machineDialog.remove.forget.description')}
                            control={
                                <button type="button" className={REMOVE_BUTTON} onClick={() => setConfirming('forget')}>
                                    {t('machineDialog.remove.forget.action')}
                                </button>
                            }
                        />
                    )}
                    {model.canRemoveFromAccount && (
                        <SettingsRow
                            label={t('machineDialog.remove.account.label')}
                            description={entry.local ? t('machineDialog.remove.account.local') : t('machineDialog.remove.account.description')}
                            control={
                                <button type="button" className={REMOVE_BUTTON} onClick={() => setConfirming('remove')}>
                                    {t('machineDialog.remove.account.action')}
                                </button>
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
