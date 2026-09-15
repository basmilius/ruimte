import { useState } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { CloudUpload, Plug, X } from 'lucide-react';
import { forgetEndpoint } from '@/endpoint';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { messageOf, usePulsarAccount, withAccessToken } from '@/pulsar/account';
import { useRegistrationFailures } from '@/pulsar/auto-register-watch';
import { addMachineToAccount, openAccountMachine, refreshAccountMachines, usePulsarMachines } from '@/pulsar/machines';
import { BackgroundServiceSection } from '@/shell/settings/BackgroundServiceSection';
import { ConfirmDialog } from '@/shell/settings/ConfirmDialog';
import { MachineIdentityForm } from '@/shell/settings/MachineIdentityForm';
import { BrokerRow, DirectRow, MachineAccess, RefuseStatementsRow, WithReason } from '@/shell/settings/MachineSettings';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useMachineIcon } from '@/shell/settings/machine-icon';
import { forgetOnClient, machineDialogModel, removeFromAccount, type MachineActionDeps } from '@/shell/settings/machine-actions';
import { nameOf, reachLabel, type MachineEntry } from '@/shell/settings/machine-list';
import { useServers } from '@/state/server';
import { useToasts } from '@/state/toasts';
import { useEndpointConnection, useMachineHold } from '@/transport/status';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

const NOT_ANSWERING = 'Available once the machine answers';

const ACTION_DEPS: MachineActionDeps = {
    forgetEndpoint,
    deleteFromAccount: (machineId) => withAccessToken((client, token) => client.deleteMachine(token, machineId)),
    refreshAccount: refreshAccountMachines
};

type Confirming = 'forget' | 'remove' | null;

function MachineDialogBody({ entry }: { entry: MachineEntry }) {
    // The dialog is a person looking at this machine, the one place in the pane that connects to it: its name, broker and paired clients are live.
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
    const reason = model.settings === 'not-answering' ? NOT_ANSWERING : null;
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
            failed(`${name} could not be opened`, e);
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
            failed(`${name} was not added to your account`, e);
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
                <Dialog.Close className="icon-btn h-7 w-7 shrink-0" aria-label="Close">
                    <Icon icon={X} size={16} />
                </Dialog.Close>
            </div>
            <div className="flex min-h-0 min-w-0 flex-col gap-5 overflow-y-auto px-5 pb-5">
                {entry.endpoint === null && (
                    <SettingsSection title="Not opened on this client">
                        <SettingsRow
                            label="Open it to change its name, icon and connection"
                            description={
                                model.canOpen
                                    ? 'It connects through the broker, on the strength of your account.'
                                    : 'This machine is not connected to a broker yet, so it can only be reached on its own network.'
                            }
                            control={
                                <Button variant="secondary" disabled={!model.canOpen} onClick={open}>
                                    <Icon icon={Plug} size={12} /> Open
                                </Button>
                            }
                        />
                    </SettingsSection>
                )}
                {entry.endpoint !== null && (
                    <>
                        <SettingsSection title="Name and icon" description="Every client that pairs with this machine sees these.">
                            <MachineIdentityForm
                                key={`${info?.nameSource ?? ''}:${info?.label ?? ''}:${JSON.stringify(info?.icon ?? null)}`}
                                endpointId={entry.endpoint.id}
                                label={entry.endpoint.label}
                                disabledReason={reason}
                            />
                        </SettingsSection>
                        {entry.local && <BackgroundServiceSection />}
                        <SettingsSection title="Connection">
                            <DirectRow endpoint={entry.endpoint} available={model.direct} />
                            <BrokerRow endpoint={entry.endpoint} reason={reason} />
                        </SettingsSection>
                        <SettingsSection title="Account">
                            {registrationFailure && (
                                <p className="px-4 py-3 text-xs break-words text-status-error" role="alert">
                                    Could not update this machine on your account: {registrationFailure}
                                </p>
                            )}
                            <RefuseStatementsRow endpoint={entry.endpoint} reason={reason} />
                            {model.canAddToAccountAgain && (
                                <SettingsRow
                                    label="Add to your account again"
                                    description="Someone took this machine off your account, so it does not join on its own."
                                    control={
                                        <WithReason reason={reason}>
                                            <Button variant="secondary" disabled={busy || reason !== null} onClick={() => void addAgain()}>
                                                <Icon icon={CloudUpload} size={12} /> Add
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
                    <SettingsSection title="Remove">
                        {model.canForget && (
                            <SettingsRow
                                label="Forget on this client"
                                description="Drops the pairing and this machine's row here. The machine, your account and other clients keep theirs."
                                control={
                                    <Button variant="secondary" onClick={() => setConfirming('forget')}>
                                        Forget
                                    </Button>
                                }
                            />
                        )}
                        {model.canRemoveFromAccount && (
                            <SettingsRow
                                label="Remove from account"
                                description={
                                    entry.local
                                        ? 'Every other client signed in to your account drops this machine. It stays here, since this app runs on it.'
                                        : 'Every client signed in to your account drops this machine, one that paired by link included. Pairing again by link puts it back.'
                                }
                                control={
                                    <Button variant="secondary" onClick={() => setConfirming('remove')}>
                                        Remove
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
                title={`Forget ${name} on this client?`}
                description="Its sessions and projects stay on the machine. To get it back here, pair again with a new link or open it from your account."
                confirmLabel="Forget"
                onConfirm={() => forgetOnClient(entry, ACTION_DEPS)}
            />
            <ConfirmDialog
                open={confirming === 'remove'}
                onOpenChange={(next) => setConfirming(next ? 'remove' : null)}
                title={`Remove ${name} from your account?`}
                description="Every client signed in to your account drops it the next time it refreshes, including a client that paired by link. Clients that are signed out keep it. The machine keeps its pairings."
                confirmLabel="Remove"
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
                <Dialog.Popup className="dialog-popup dialog-popup-nested flex max-h-[calc(100dvh-32px)] w-[560px] flex-col">
                    {entry && <MachineDialogBody entry={entry} />}
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
