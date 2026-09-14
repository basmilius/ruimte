import { useEffect, useState } from 'react';
import { CloudUpload, LogIn, LogOut, Plug, Trash } from 'lucide-react';
import { ProjectIconChoiceSchema } from '@ruimte/contracts';
import type { Machine } from '@ruimte/pulsar';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { cancelPulsarSignIn, messageOf, signInToPulsar, signOutOfPulsar, usePulsarAccount } from '@/pulsar/account';
import {
    addMachineToAccount,
    forgetAccountMachines,
    openAccountMachine,
    refreshAccountMachines,
    removeMachineFromAccount,
    rowForAccountMachine,
    usePulsarMachines
} from '@/pulsar/machines';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Skeleton } from '@/shell/settings/controls';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { useToasts } from '@/state/toasts';
import { useEndpointConnection } from '@/transport/status';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const failed = (title: string, e: unknown): void => {
    useToasts.getState().show({ id: `pulsar-${title}`, kind: 'error', title, description: messageOf(e) });
};

/*
 * The button on a machine's row that puts it on the account. The machine signs its agreement and this
 * client posts it, so it only shows while the machine answers and nobody put it on the account yet.
 */
export function AddToAccountButton({ endpoint }: { endpoint: Endpoint }) {
    const status = usePulsarAccount((s) => s.status);
    const machines = usePulsarMachines((s) => s.machines);
    const connected = useEndpointConnection(endpoint.id).status === 'open';
    const [busy, setBusy] = useState(false);
    const machineId = endpoint.daemonId ?? endpoint.id;

    if (status !== 'signed-in' || machines === null || machines.some((machine) => machine.id === machineId)) {
        return null;
    }

    const add = async (): Promise<void> => {
        setBusy(true);
        try {
            await addMachineToAccount(endpoint.id);
        } catch (e) {
            failed(`${endpoint.label} was not added to your account`, e);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Tooltip label={connected ? 'Add to your account' : 'Available once the machine answers'} name>
            <button className="icon-btn h-8 w-8" disabled={!connected || busy} onClick={() => void add()}>
                <Icon icon={CloudUpload} size={16} />
            </button>
        </Tooltip>
    );
}

/* A machine on the account: on this client already, or a way to open it from here. */
function AccountMachineRow({ machine }: { machine: Machine }) {
    const onClient = useEndpoints((s) => rowForAccountMachine(machine.id, s.endpoints));
    const [busy, setBusy] = useState(false);
    const icon = ProjectIconChoiceSchema.safeParse(machine.icon);

    const open = (): void => {
        try {
            openAccountMachine(machine);
        } catch (e) {
            failed(`${machine.name} could not be opened`, e);
        }
    };

    const remove = async (): Promise<void> => {
        setBusy(true);
        try {
            await removeMachineFromAccount(machine.id);
        } catch (e) {
            failed(`${machine.name} was not removed`, e);
        } finally {
            setBusy(false);
        }
    };

    const note =
        onClient !== null
            ? `On this client as ${onClient.label}`
            : machine.brokerUrl === null
              ? 'Not on a broker, so it cannot be opened from another network'
              : `Added ${machine.lastSeenAt === null ? '' : new Date(machine.lastSeenAt).toLocaleDateString()}`.trim();

    return (
        <SettingsRow
            label={
                <span className="flex items-center gap-2">
                    <MachineGlyph icon={icon.success ? icon.data : null} className="shrink-0 text-text-muted" />
                    <span className="flex min-w-0 flex-col">
                        <span className="truncate">{machine.name}</span>
                        <span className="truncate text-xs text-text-faint">{note}</span>
                    </span>
                </span>
            }
            control={
                <>
                    {onClient === null && (
                        <Button variant="secondary" disabled={machine.brokerUrl === null} onClick={open}>
                            <Icon icon={Plug} size={12} /> Open
                        </Button>
                    )}
                    <Tooltip label="Remove from your account" name>
                        <button className="icon-btn h-8 w-8" disabled={busy} onClick={() => void remove()}>
                            <Icon icon={Trash} size={16} />
                        </button>
                    </Tooltip>
                </>
            }
        />
    );
}

/*
 * Signing in, and the machines on the account. Signing in is what lets a client reach a machine it
 * never paired with: the account vouches for this client's key, and every machine that takes such a
 * statement lists the client under Apps with access.
 */
export function AccountSection() {
    const status = usePulsarAccount((s) => s.status);
    const account = usePulsarAccount((s) => s.account);
    const error = usePulsarAccount((s) => s.error);
    const machines = usePulsarMachines((s) => s.machines);
    const machinesError = usePulsarMachines((s) => s.error);

    useEffect(() => {
        if (status === 'signed-in') {
            void refreshAccountMachines();
        } else if (status === 'signed-out') {
            forgetAccountMachines();
        }
    }, [status]);

    if (status === 'unavailable') {
        return (
            <SettingsSection title="Account" description="Reach your machines from another network.">
                <SettingsRow muted label="Signing in works in the desktop app." description="A browser has no safe place to keep the session." />
            </SettingsSection>
        );
    }

    const signOut = async (): Promise<void> => {
        await signOutOfPulsar();
    };

    return (
        <SettingsSection
            title="Account"
            description="Machines on your account can be opened from any client you sign in on. Each one lists that client under Apps with access."
        >
            {status === 'loading' && <SettingsRow label={<Skeleton className="w-40" />} control={<Skeleton className="w-20" />} />}
            {status === 'signed-out' && (
                <SettingsRow
                    label="Not signed in"
                    description="Signing in opens GitHub in your browser."
                    control={
                        <Button variant="primary" onClick={() => void signInToPulsar()}>
                            <Icon icon={LogIn} size={12} /> Sign in with GitHub
                        </Button>
                    }
                />
            )}
            {status === 'signing-in' && (
                <SettingsRow
                    label="Waiting for your browser"
                    description="Finish signing in there, then come back."
                    control={<Button onClick={() => void cancelPulsarSignIn()}>Cancel</Button>}
                />
            )}
            {status === 'signed-in' && account && (
                <SettingsRow
                    label={account.login === null ? 'Signed in with GitHub' : `Signed in as ${account.login}`}
                    description="Anyone who takes over this GitHub account can reach these machines, so turn on two-factor authentication there."
                    control={
                        <Button onClick={() => void signOut()}>
                            <Icon icon={LogOut} size={12} /> Sign out
                        </Button>
                    }
                />
            )}
            {error !== null && <SettingsRow muted label={<span className="text-status-error">{error}</span>} />}
            {status === 'signed-in' && machines === null && machinesError === null && (
                <SettingsRow label={<Skeleton className="w-40" />} control={<Skeleton className="w-8" />} />
            )}
            {status === 'signed-in' && machines?.length === 0 && (
                <SettingsRow muted label="No machines on your account yet" description="Add one with the upload button on its row above." />
            )}
            {status === 'signed-in' && machines?.map((machine) => <AccountMachineRow key={machine.id} machine={machine} />)}
            {status === 'signed-in' && machinesError !== null && <SettingsRow muted label={<span className="text-status-error">{machinesError}</span>} />}
        </SettingsSection>
    );
}
