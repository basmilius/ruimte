import clsx from 'clsx';
import { LogIn, MonitorSmartphone } from 'lucide-react';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { usePulsarAccount } from '@/pulsar/account';
import { openMachine, useProjectSwitch } from '@/project/open';
import type { SwitchState } from '@/project/project-switch';
import { usePulsarMachines } from '@/pulsar/machines';
import { linkDot, linkHint, machineLink, type LinkWait } from '@/shell/palette-browse';
import { SignInButtons } from '@/shell/SignInButtons';
import { useMachineIcon } from '@/shell/settings/machine-icon';
import { mergeMachines, nameOf, type MachineEntry } from '@/shell/settings/machine-list';
import { stationBoot } from '@/station';
import { useEndpoints } from '@/state/endpoints';
import { hasLocalMachine } from '@/state/local-machine';
import { useEndpointConnection } from '@/transport/status';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';

/* The row's own line for the moment before the switch screen takes over the column. */
const waitOf = (state: SwitchState, entry: MachineEntry): LinkWait | null => {
    if (state.kind === 'idle' || (state.target.endpointId !== entry.id && state.target.endpointId !== entry.endpoint?.id)) {
        return null;
    }
    return state.kind === 'failed' ? { state: 'failed', reason: state.reason } : { state: 'connecting' };
};

interface MachineChoiceProps {
    entry: MachineEntry;
    wait: LinkWait | null;
    onPick: () => void;
}

/* One machine to work on, with the same line of state the palette's machines step shows. */
function MachineChoice({ entry, wait, onPick }: MachineChoiceProps) {
    const endpointId = entry.endpoint?.id ?? entry.id;
    const connection = useEndpointConnection(endpointId);
    const icon = useMachineIcon(entry);
    const link = machineLink(entry, connection, wait);
    const hint = linkHint(link);
    return (
        <div className="flex w-full items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left">
            <MachineGlyph icon={icon} className="shrink-0 text-text-muted" />
            <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-sm text-text">{nameOf(entry)}</span>
                {hint && <span className={clsx('text-xs', link.kind === 'failed' ? 'text-status-error' : 'text-text-faint')}>{hint}</span>}
            </span>
            <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', linkDot(link))} />
            <Button size="sm" variant="secondary" disabled={link.kind === 'connecting'} onClick={onPick}>
                {link.kind === 'failed' ? 'Try again' : 'Open'}
            </Button>
        </div>
    );
}

/*
 * The main column of the web client before a machine is picked. There is no machine behind this page,
 * so nothing is loading and nothing is wrong: a person signs in, and opens one of the machines on the
 * account. A machine lands on the account by being opened once in the desktop app while signed in.
 */
export function StationWelcome() {
    const activeEndpointId = useEndpoints((s) => s.activeId);
    const endpoints = useEndpoints((s) => s.endpoints);
    const accountStatus = usePulsarAccount((s) => s.status);
    const notice = usePulsarAccount((s) => s.notice);
    const error = usePulsarAccount((s) => s.error);
    const machines = usePulsarMachines((s) => s.machines);
    const switching = useProjectSwitch((s) => s);
    const boot = stationBoot({ station: !hasLocalMachine(), activeEndpointId, accountStatus, machines });

    if (boot === null) {
        return null;
    }

    const entries = mergeMachines({ endpoints, accountMachines: machines, showLocal: hasLocalMachine() });

    /* Through the same switch as a project, so the wait and a failure read the same as they do there. */
    const pick = (entry: MachineEntry): void => {
        void openMachine(entry.endpoint?.id ?? entry.id);
    };

    return (
        <div className="absolute inset-0 grid place-items-center bg-surface-sunken">
            {(boot === 'loading' || boot === 'signing-in') && (
                <EmptyState icon={<Icon icon={MonitorSmartphone} size={20} />}>
                    {boot === 'signing-in' ? 'Signing in...' : 'Looking up your machines...'}
                </EmptyState>
            )}
            {boot === 'sign-in' && (
                <EmptyState icon={<Icon icon={LogIn} size={20} />} action={<SignInButtons className="justify-center" />}>
                    {notice ?? error ?? 'Sign in to open the machines on your account from this browser.'}
                </EmptyState>
            )}
            {boot === 'machines' && (
                <EmptyState
                    icon={<Icon icon={MonitorSmartphone} size={20} />}
                    action={
                        entries.length === 0 ? undefined : (
                            <div className="flex w-96 max-w-full flex-col gap-2">
                                {entries.map((entry) => (
                                    <MachineChoice key={entry.id} entry={entry} wait={waitOf(switching, entry)} onPick={() => pick(entry)} />
                                ))}
                            </div>
                        )
                    }
                >
                    {entries.length === 0
                        ? 'No machine is on your account yet. Sign in to the desktop app on a machine that runs with a broker, and it joins your account on its own.'
                        : 'Pick a machine to work on.'}
                </EmptyState>
            )}
        </div>
    );
}
