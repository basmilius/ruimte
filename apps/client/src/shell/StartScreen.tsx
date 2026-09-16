import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { isRecentProject } from '@ruimte/contracts';
import { FolderOpen, LogIn, MonitorSmartphone, Plus } from 'lucide-react';
import { useTrafficLightInset } from '@/desktop/useFullscreen';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { recentProjects } from '@/project/list';
import { createProjectOn, openProject } from '@/project/open';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { usePulsarAccount } from '@/pulsar/account';
import { usePulsarMachines } from '@/pulsar/machines';
import { ProjectNameDialog } from '@/shell/ProjectNameDialog';
import { linkDot, linkHint, machineLink } from '@/shell/palette-browse';
import { SignInButtons } from '@/shell/SignInButtons';
import { STRIP_PADDING_PX } from '@/shell/Sidebar';
import { useMachineIcon } from '@/shell/settings/machine-icon';
import { mergeMachines, nameOf, type MachineEntry } from '@/shell/settings/machine-list';
import { useEndpoints } from '@/state/endpoints';
import { hasLocalMachine, isRealMachine } from '@/state/local-machine';
import { useProjectList } from '@/state/project-list';
import { useUi } from '@/state/ui';
import { useEndpointConnection, useOpenEndpoints } from '@/transport/status';
import { Brand } from '@/ui/Brand';
import { SECTION_LABEL } from '@/ui/classes';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Icon } from '@/ui/Icon';

const ROW = 'flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-text hover:bg-surface-hover disabled:opacity-50';

/* One machine, with the line of state the palette's machines step shows; picking it browses its folders. */
function MachineRow({ entry }: { entry: MachineEntry }) {
    const endpointId = entry.endpoint?.id ?? entry.id;
    const connection = useEndpointConnection(endpointId);
    const icon = useMachineIcon(entry);
    const link = machineLink(entry, connection, null);
    const hint = linkHint(link);
    return (
        <button className={ROW} onClick={() => useUi.getState().openFolderBrowser(endpointId)}>
            <MachineGlyph icon={icon} size={14} className="shrink-0 text-text-muted" />
            <span className="min-w-0 truncate">{nameOf(entry)}</span>
            {hint && <span className="min-w-0 truncate text-xs text-text-faint">{hint}</span>}
            <span className={clsx('ml-auto h-1.5 w-1.5 shrink-0 rounded-full', linkDot(link))} />
        </button>
    );
}

function StartContent() {
    const endpoints = useEndpoints((s) => s.endpoints);
    const activeId = useEndpoints((s) => s.activeId);
    const rows = useProjectList((s) => s.projects);
    const connected = useOpenEndpoints();
    const accountStatus = usePulsarAccount((s) => s.status);
    const accountMachines = usePulsarMachines((s) => s.machines);
    const [newOpen, setNewOpen] = useState(false);
    const recent = useMemo(() => recentProjects(rows, endpoints, connected), [rows, endpoints, connected]);
    const machines = useMemo(
        () => mergeMachines({ endpoints, accountMachines: accountStatus === 'signed-in' ? accountMachines : null, showLocal: hasLocalMachine() }),
        [endpoints, accountMachines, accountStatus]
    );
    const signedOut = accountStatus === 'signed-out' || accountStatus === 'unavailable';

    return (
        <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-6 py-10">
            <Brand size={24} />
            <section className="flex flex-col gap-px">
                <button className={ROW} onClick={() => useUi.getState().openFolderBrowser()}>
                    <Icon icon={FolderOpen} size={14} className="text-text-muted" /> Open folder
                </button>
                <button className={ROW} disabled={!isRealMachine(activeId)} onClick={() => setNewOpen(true)}>
                    <Icon icon={Plus} size={14} className="text-text-muted" /> New project
                </button>
                <button className={ROW} onClick={() => useUi.getState().setSettings({ open: true, section: 'machines' })}>
                    <Icon icon={MonitorSmartphone} size={14} className="text-text-muted" /> Connect machine
                </button>
                {signedOut && (
                    <div className="flex flex-col gap-2 px-2 py-1">
                        <span className="flex items-center gap-2 text-sm text-text">
                            <Icon icon={LogIn} size={14} className="text-text-muted" /> Sign in
                        </span>
                        <SignInButtons />
                    </div>
                )}
            </section>
            {machines.length > 0 && (
                <section className="flex flex-col gap-px">
                    <div className={`${SECTION_LABEL} px-2 py-1`}>Machines</div>
                    {machines.map((entry) => (
                        <MachineRow key={entry.id} entry={entry} />
                    ))}
                </section>
            )}
            {recent.length > 0 && (
                <section className="flex flex-col gap-px">
                    <div className={`${SECTION_LABEL} px-2 py-1`}>Recent</div>
                    {recent.map((row) => (
                        <button
                            key={`${row.endpointId}:${row.summary.projectId}`}
                            className={clsx(ROW, !row.connected && 'text-text-muted')}
                            disabled={!row.summary.available}
                            onClick={() => void openProject(row.endpointId, row.summary.projectId)}
                        >
                            <ProjectGlyph projectId={row.summary.projectId} endpointId={row.endpointId} icon={row.summary.icon} color={row.summary.color} />
                            <span className="min-w-0 truncate">{row.summary.name}</span>
                            <span className="ml-auto min-w-0 truncate text-xs text-text-faint">
                                {isRecentProject(row.summary) ? `${row.machineLabel} · closed` : row.machineLabel}
                            </span>
                        </button>
                    ))}
                </section>
            )}
            <ProjectNameDialog
                open={newOpen}
                onOpenChange={setNewOpen}
                title="New project"
                description="Stored in the app, not in a folder. To share a project through git, open a folder instead."
                action="Create"
                fallback="Untitled project"
                onSubmit={async (name) => {
                    await createProjectOn(activeId, name);
                }}
            />
        </div>
    );
}

/*
 * What a window shows while nothing is open: the ways to start, the machines and the projects there
 * are. It fills the window and has no sidebar, so the strip at the top is what drags the window.
 */
export function StartScreen() {
    const inset = useTrafficLightInset();
    return (
        <div className="flex h-full w-full flex-col bg-bg">
            <div className="app-drag h-12 shrink-0" style={{ paddingLeft: inset ?? STRIP_PADDING_PX }} />
            <div className="min-h-0 grow overflow-auto">
                <ErrorBoundary label="The start screen failed to render">
                    <StartContent />
                </ErrorBoundary>
            </div>
        </div>
    );
}
