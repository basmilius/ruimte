import { LogIn, MonitorSmartphone } from 'lucide-react';
import { ProjectIconChoiceSchema } from '@ruimte/contracts';
import type { Machine } from '@ruimte/pulsar';
import { activateEndpoint } from '@/endpoint';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { messageOf, signInToPulsar, usePulsarAccount } from '@/pulsar/account';
import { openAccountMachine, usePulsarMachines } from '@/pulsar/machines';
import { IS_STATION, stationBoot } from '@/station';
import { useEndpoints } from '@/state/endpoints';
import { useToasts } from '@/state/toasts';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';

/* Picks a machine from the account: the row that reaches it over its broker, and the whole client moved onto it. */
const openMachine = async (machine: Machine): Promise<void> => {
    try {
        const row = openAccountMachine(machine);
        await activateEndpoint(row.id);
    } catch (e) {
        useToasts.getState().show({ id: `station-open-${machine.id}`, kind: 'error', title: `${machine.name} could not be opened`, description: messageOf(e) });
    }
};

function MachineButton({ machine }: { machine: Machine }) {
    const icon = ProjectIconChoiceSchema.safeParse(machine.icon);
    const reachable = machine.brokerUrl !== null;
    return (
        <Button variant="secondary" disabled={!reachable} onClick={() => void openMachine(machine)}>
            <MachineGlyph icon={icon.success ? icon.data : null} className="shrink-0 text-text-muted" />
            <span className="truncate">{machine.name}</span>
        </Button>
    );
}

/*
 * The main column of the web client before a machine is picked. There is no machine behind this page,
 * so nothing is loading and nothing is wrong: a person signs in, and opens one of the machines on the
 * account. A machine lands on the account by being opened once in the desktop app while signed in.
 */
export function StationWelcome() {
    const activeEndpointId = useEndpoints((s) => s.activeId);
    const accountStatus = usePulsarAccount((s) => s.status);
    const notice = usePulsarAccount((s) => s.notice);
    const error = usePulsarAccount((s) => s.error);
    const machines = usePulsarMachines((s) => s.machines);
    const boot = stationBoot({ station: IS_STATION, activeEndpointId, accountStatus, machines });

    if (boot === null) {
        return null;
    }

    const reachable = machines?.filter((machine) => machine.brokerUrl !== null) ?? [];

    return (
        <div className="absolute inset-0 grid place-items-center bg-surface-sunken">
            {(boot === 'loading' || boot === 'signing-in') && (
                <EmptyState icon={<Icon icon={MonitorSmartphone} size={20} />}>
                    {boot === 'signing-in' ? 'Signing in...' : 'Looking up your machines...'}
                </EmptyState>
            )}
            {boot === 'sign-in' && (
                <EmptyState
                    icon={<Icon icon={LogIn} size={20} />}
                    action={
                        <Button variant="primary" onClick={() => void signInToPulsar()}>
                            <Icon icon={LogIn} size={12} /> Sign in with GitHub
                        </Button>
                    }
                >
                    {notice ?? error ?? 'Sign in to open the machines on your account from this browser.'}
                </EmptyState>
            )}
            {boot === 'machines' && (
                <EmptyState
                    icon={<Icon icon={MonitorSmartphone} size={20} />}
                    action={
                        reachable.length === 0 ? undefined : (
                            <div className="flex max-w-md flex-wrap items-center justify-center gap-2">
                                {reachable.map((machine) => (
                                    <MachineButton key={machine.id} machine={machine} />
                                ))}
                            </div>
                        )
                    }
                >
                    {reachable.length === 0
                        ? 'No machine on your account can be reached from here yet. Sign in to the desktop app on a machine that runs with a broker, and it joins your account on its own.'
                        : 'Pick a machine to work on.'}
                </EmptyState>
            )}
        </div>
    );
}
