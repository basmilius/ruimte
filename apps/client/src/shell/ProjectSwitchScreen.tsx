import { useMemo, type ReactNode } from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
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

/* A machine as the Machines pane knows it: a paired row, or only the account's record. */
export const useMachineEntry = (endpointId: string): MachineEntry => {
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
    target.summary?.name ?? target.name ?? (target.folder !== null ? basenameOf(target.folder) || target.folder : machine);

const lineOf = (state: Exclude<SwitchState, { kind: 'idle' }>, title: string, machine: string): string => {
    switch (state.kind) {
        case 'connecting':
            return i18next.t('shell:switch.connecting', { machine });
        case 'opening':
            return i18next.t('shell:switch.opening', { title });
        case 'returning':
            return i18next.t('shell:switch.returning');
        case 'failed':
            return state.reason;
    }
};

interface StatusCardProps {
    glyph: ReactNode;
    title: string;
    /* The line under the title: the machine a project is on, or when a machine was last seen. */
    meta?: ReactNode;
    line: string;
    failed: boolean;
    children?: ReactNode;
}

/* The card the window shows while it waits on a machine or after one failed it: what, where, why, and what to do. */
export function StatusCard({ glyph, title, meta, line, failed, children }: StatusCardProps) {
    return (
        <div className="flex w-80 max-w-full flex-col items-center gap-3 px-6 text-center">
            {glyph}
            <div className="flex max-w-full flex-col items-center gap-1">
                <span className="max-w-full truncate text-sm font-medium text-text">{title}</span>
                {meta}
            </div>
            <p className="flex items-start gap-2 text-xs leading-snug text-text-muted">
                <Icon
                    icon={failed ? CircleAlert : LoaderCircle}
                    size={14}
                    className={failed ? 'mt-px shrink-0 text-status-error' : 'mt-px shrink-0 animate-spin'}
                />
                <span>{line}</span>
            </p>
            {children && <div className="mt-2 flex items-center gap-2">{children}</div>}
        </div>
    );
}

function SwitchCard({ state }: { state: Exclude<SwitchState, { kind: 'idle' }> }) {
    const { t } = useTranslation(['shell', 'common']);
    const { target } = state;
    const entry = useMachineEntry(target.endpointId);
    const machineIcon = useMachineIcon(entry);
    const connection = useEndpointConnection(entry.endpoint?.id ?? target.endpointId);
    const machine = nameOf(entry);
    const title = titleOf(target, machine);
    // A project the cached list does not have has nothing but its machine's name to show, and saying it twice says nothing.
    const aboutMachine = target.summary === null && target.folder === null && target.name === null;
    const failed = state.kind === 'failed';

    return (
        <StatusCard
            glyph={
                target.summary ? (
                    <ProjectGlyph
                        projectId={target.summary.projectId}
                        endpointId={target.endpointId}
                        icon={target.summary.icon}
                        color={target.summary.color}
                        size={24}
                    />
                ) : (
                    <MachineGlyph icon={aboutMachine ? machineIcon : null} size={24} className="text-text-faint" />
                )
            }
            title={title}
            meta={
                !aboutMachine && (
                    <span className="flex max-w-full items-center gap-1.5 text-xs text-text-muted">
                        <MachineGlyph icon={machineIcon} size={12} />
                        <span className="truncate">{machine}</span>
                        {/* Known only once the link is open, which is exactly when the project step runs. */}
                        {state.kind === 'opening' && connection.relayed && <span className="shrink-0 text-text-faint">{t('switch.viaRelay')}</span>}
                    </span>
                )
            }
            line={lineOf(state, title, machine)}
            failed={failed}
        >
            {(state.kind === 'connecting' || state.kind === 'opening') && (
                <Button size="sm" variant="secondary" onClick={() => projectSwitch.cancel()}>
                    {t('common:action.cancel')}
                </Button>
            )}
            {failed && (
                <>
                    <Button size="sm" variant="secondary" onClick={() => void projectSwitch.back()}>
                        {t('switch.goBack')}
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => void projectSwitch.retry()}>
                        {t('common:action.retry')}
                    </Button>
                </>
            )}
        </StatusCard>
    );
}

/*
 * Stands over the main column while the window moves to another project, and over the whole start screen when it moves from there, so a machine that takes
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
