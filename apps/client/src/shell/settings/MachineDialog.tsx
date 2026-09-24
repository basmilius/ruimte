import { useState } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { CloudUpload, Plug, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { forgetEndpoint } from '@/endpoint';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { messageOf, usePulsarAccount, withAccessToken } from '@/pulsar/account';
import { useRegistrationFailures } from '@/pulsar/auto-register-watch';
import { addMachineToAccount, openAccountMachine, refreshAccountMachines, usePulsarMachines } from '@/pulsar/machines';
import { BackgroundServiceSection } from '@/shell/settings/BackgroundServiceSection';
import { ConfirmDialog } from '@/shell/settings/ConfirmDialog';
import { MachineIdentityForm } from '@/shell/settings/MachineIdentityForm';
import { BrokerRow, DirectRow, MachineAccess, RefuseStatementsRow, StreamingRow, WithReason } from '@/shell/settings/MachineSettings';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useMachineIcon } from '@/shell/settings/machine-icon';
import { forgetOnClient, machineDialogModel, removeFromAccount, type MachineActionDeps } from '@/shell/settings/machine-actions';
import { nameOf, reachLabel, type MachineEntry } from '@/shell/settings/machine-list';
import { useServers } from '@/state/server';
import { useToasts } from '@/state/toasts';
import { useEndpointConnection, useMachineHold } from '@/transport/status';
import { Button } from '@/ui/Button';
import { FORM_ERROR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';

const ACTION_DEPS: MachineActionDeps = {
    forgetEndpoint,
    deleteFromAccount: (machineId) => withAccessToken((client, token) => client.deleteMachine(token, machineId)),
    refreshAccount: refreshAccountMachines
};

type Confirming = 'forget' | 'remove' | null;

function MachineDialogBody({ entry }: { entry: MachineEntry }) {
    const { t } = useTranslation('settings');
    // The dialog is a person looking at this machine, the one place in the pane that connects to it. Its name, broker and paired clients are live.
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
            <div className="flex min-w-0 items-start gap-3 px-5 pt-5 pb-4">
                <MachineGlyph icon={icon} size={32} className="shrink-0 text-text-muted" />
                <div className="min-w-0 grow">
                    <Dialog.Title className="truncate text-base font-semibold text-text">{name}</Dialog.Title>
                    <Dialog.Description className="mt-0.5 text-xs break-words text-text-muted">{reachLabel(entry)}</Dialog.Description>
                </div>
                <Dialog.Close className="icon-btn h-7 w-7 shrink-0" aria-label={t('common:action.close')}>
                    <Icon icon={X} size={16} />
                </Dialog.Close>
            </div>
            <div className="flex min-h-0 min-w-0 flex-col gap-5 overflow-y-auto px-5 pb-5">
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
                        <SettingsSection title={t('machineDialog.identity.title')} description={t('machineDialog.identity.description')}>
                            <MachineIdentityForm
                                key={`${info?.nameSource ?? ''}:${info?.label ?? ''}:${JSON.stringify(info?.icon ?? null)}`}
                                endpointId={entry.endpoint.id}
                                label={entry.endpoint.label}
                                disabledReason={reason}
                            />
                        </SettingsSection>
                        {entry.local && <BackgroundServiceSection />}
                        <SettingsSection title={t('machineDialog.connection')}>
                            <DirectRow endpoint={entry.endpoint} available={model.direct} />
                            <BrokerRow endpoint={entry.endpoint} reason={reason} />
                        </SettingsSection>
                        <SettingsSection title={t('machineDialog.streaming')}>
                            <StreamingRow endpoint={entry.endpoint} reason={reason} />
                        </SettingsSection>
                        <SettingsSection title={t('machineDialog.account.title')}>
                            {registrationFailure && (
                                <p className={`${FORM_ERROR} px-4 py-3 break-words`} role="alert">
                                    {t('machineDialog.account.registrationFailure', { reason: registrationFailure })}
                                </p>
                            )}
                            <RefuseStatementsRow endpoint={entry.endpoint} reason={reason} />
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
                                    <Button variant="secondary" onClick={() => setConfirming('forget')}>
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
                                    <Button variant="secondary" onClick={() => setConfirming('remove')}>
                                        {t('machineDialog.remove.account.action')}
                                    </Button>
                                }
                            />
                        )}
                    </SettingsSection>
                )}
            </div>
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

interface MachineDialogProps {
    entry: MachineEntry | null;
    open: boolean;
    onOpenChange(open: boolean): void;
}

/* Everything about one machine, opened from its row in the Machines pane. */
export function MachineDialog({ entry, open, onOpenChange }: MachineDialogProps) {
    return (
        <Dialog.Root open={open && entry !== null} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop dialog-backdrop-nested" forceRender />
                <Dialog.Popup className="dialog-popup dialog-popup-nested flex w-[560px] flex-col">{entry && <MachineDialogBody entry={entry} />}</Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
