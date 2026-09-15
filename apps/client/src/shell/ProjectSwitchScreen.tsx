import { useMemo } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { projectSwitch, useProjectSwitch } from '@/project/open';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import type { SwitchState, SwitchTarget } from '@/project/project-switch';
import { usePulsarMachines } from '@/pulsar/machines';
import { basenameOf } from '@/shell/panels/files-tree';
import { useMachineIcon } from '@/shell/settings/machine-icon';
import { mergeMachines, nameOf, type MachineEntry } from '@/shell/settings/machine-list';
import { useEndpoints } from '@/state/endpoints';
import { useEndpointConnection } from '@/transport/status';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

/* The machine a switch is going to, as the Machines pane knows it: a paired row, or only the account's record. */
const useMachineEntry = (endpointId: string): MachineEntry => {
    const endpoints = useEndpoints((s) => s.endpoints);
    const machines = usePulsarMachines((s) => s.machines);
    return useMemo(
        () =>
            mergeMachines({ endpoints, accountMachines: machines, showLocal: true }).find(
                (entry) => entry.id === endpointId || entry.endpoint?.id === endpointId
            ) ?? {
                id: endpointId,
                endpoint: null,
                machine: null,
                local: false,
                paired: false,
                onAccount: false
            },
        [endpointId, endpoints, machines]
    );
};

/* What is being opened, in the words a person picked it by. */
const titleOf = (target: SwitchTarget, machine: string): string =>
    target.summary?.name ?? (target.folder !== null ? basenameOf(target.folder) || target.folder : machine);

const lineOf = (state: Exclude<SwitchState, { kind: 'idle' }>, title: string, machine: string): string => {
    switch (state.kind) {
        case 'connecting':
            return `Connecting to ${machine}...`;
        case 'opening':
            return `Opening ${title}...`;
        case 'returning':
            return 'Going back...';
        case 'failed':
            return state.reason;
    }
};

function SwitchCard({ state }: { state: Exclude<SwitchState, { kind: 'idle' }> }) {
    const { target } = state;
    const entry = useMachineEntry(target.endpointId);
    const machineIcon = useMachineIcon(entry);
    const connection = useEndpointConnection(entry.endpoint?.id ?? target.endpointId);
    const machine = nameOf(entry);
    const title = titleOf(target, machine);
    // Only a machine picked on its own has nothing but its name to show, and saying it twice says nothing.
    const aboutMachine = target.summary === null && target.folder === null;
    const failed = state.kind === 'failed';

    return (
        <div className="flex w-80 max-w-full flex-col items-center gap-3 px-6 text-center">
            {target.summary ? (
                <ProjectGlyph
                    projectId={target.summary.projectId}
                    endpointId={target.endpointId}
                    icon={target.summary.icon}
                    color={target.summary.color}
                    size={24}
                />
            ) : (
                <MachineGlyph icon={aboutMachine ? machineIcon : null} size={24} className="text-text-faint" />
            )}
            <div className="flex max-w-full flex-col items-center gap-1">
                <span className="max-w-full truncate text-sm font-medium text-text">{title}</span>
                {!aboutMachine && (
                    <span className="flex max-w-full items-center gap-1.5 text-xs text-text-muted">
                        <MachineGlyph icon={machineIcon} size={12} />
                        <span className="truncate">{machine}</span>
                        {/* Known only once the link is open, which is exactly when the project step runs. */}
                        {state.kind === 'opening' && connection.relayed && <span className="shrink-0 text-text-faint">via relay</span>}
                    </span>
                )}
            </div>
            <p className="flex items-start gap-2 text-xs leading-snug text-text-muted">
                <Icon
                    icon={failed ? CircleAlert : LoaderCircle}
                    size={14}
                    className={failed ? 'mt-px shrink-0 text-status-error' : 'mt-px shrink-0 animate-spin'}
                />
                <span>{lineOf(state, title, machine)}</span>
            </p>
            {(state.kind === 'connecting' || state.kind === 'opening') && (
                <Button size="sm" variant="secondary" className="mt-2" onClick={() => projectSwitch.cancel()}>
                    Cancel
                </Button>
            )}
            {failed && (
                <div className="mt-2 flex items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => void projectSwitch.back()}>
                        Go back
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => void projectSwitch.retry()}>
                        Try again
                    </Button>
                </div>
            )}
        </div>
    );
}

/*
 * Stands over the main column while the client moves to another project, so a machine that takes
 * seconds to answer reads as waiting rather than frozen. Nothing for the first moments of a switch
 * (`REVEAL_DELAY_MS`), and a failure stays until a person picks what to do about it.
 */
export function ProjectSwitchScreen() {
    const state = useProjectSwitch((s) => s);
    if (state.kind === 'idle' || (state.kind !== 'failed' && !state.visible)) {
        return null;
    }
    return (
        <div className="absolute inset-0 z-10 grid place-items-center bg-surface-sunken" role="status" aria-live="polite">
            <SwitchCard state={state} />
        </div>
    );
}
