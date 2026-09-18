import { useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { isRecentProject } from '@ruimte/contracts';
import { FolderOpen, LogIn, MonitorSmartphone, Plus, RotateCw } from 'lucide-react';
import { isDesktop } from '@/desktop/bridge';
import { useTrafficLightInset } from '@/desktop/useFullscreen';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { openableRows, recentProjects, type ProjectMenuRow } from '@/project/list';
import { createProjectOn, openProject } from '@/project/open';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { usePulsarAccount } from '@/pulsar/account';
import { usePulsarMachines } from '@/pulsar/machines';
import { LinkMachineDialog } from '@/shell/LinkMachineDialog';
import { ProjectNameDialog } from '@/shell/ProjectNameDialog';
import { linkDot, linkHint, machineLink } from '@/shell/palette-browse';
import { SignInButtons } from '@/shell/SignInButtons';
import { STRIP_PADDING_PX } from '@/shell/Sidebar';
import { runAppShortcut } from '@/shell/app-shortcuts';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { AddMachineDialog } from '@/shell/settings/MachinesSection';
import { useMachineIcon } from '@/shell/settings/machine-icon';
import { mergeMachines, nameOf, type MachineEntry } from '@/shell/settings/machine-list';
import { stationBoot } from '@/station';
import { useEndpoints } from '@/state/endpoints';
import { hasLocalMachine, isRealMachine } from '@/state/local-machine';
import { useProjectList } from '@/state/project-list';
import { canShowReleaseNotes, openReleaseNotes } from '@/state/release-notes';
import { useUi } from '@/state/ui';
import { useUpdates } from '@/state/updates';
import { useWindow, type BootFailure } from '@/state/window';
import { useEndpointConnection, useOpenEndpoints } from '@/transport/status';
import { BrandIntro } from '@/ui/Brand';
import { Button } from '@/ui/Button';
import { SECTION_LABEL, TOOLTIP_KBD } from '@/ui/classes';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Icon } from '@/ui/Icon';
import { Kbd } from '@/ui/Kbd';
import { Tile } from '@/ui/Tile';

const ROW = 'flex min-h-10 w-full min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover disabled:opacity-50';

function Section({ label, children }: { label: string; children: ReactNode }) {
    return (
        <section className="flex min-w-0 flex-col gap-2">
            <h2 className={`${SECTION_LABEL} px-2`}>{label}</h2>
            {children}
        </section>
    );
}

/* One machine, with the line of state the palette's machines step shows; picking it browses its folders. */
function MachineRow({ entry }: { entry: MachineEntry }) {
    const endpointId = entry.endpoint?.id ?? entry.id;
    const connection = useEndpointConnection(endpointId);
    const icon = useMachineIcon(entry);
    const link = machineLink(entry, connection, null);
    const hint = linkHint(link);
    return (
        <button className={ROW} onClick={() => useUi.getState().openFolderBrowser(endpointId)}>
            <MachineGlyph icon={icon} size={16} className="shrink-0 text-text-muted" />
            <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-sm text-text">{nameOf(entry)}</span>
                {hint && <span className={clsx('truncate text-xs', link.kind === 'failed' ? 'text-status-error' : 'text-text-faint')}>{hint}</span>}
            </span>
            <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', linkDot(link))} />
        </button>
    );
}

/* A project to go back to. A row of a machine that is not connected is what that machine last answered, so it says so. */
function RecentRow({ row }: { row: ProjectMenuRow }) {
    const { summary } = row;
    const where = [row.machineLabel, row.connected ? null : 'not connected', isRecentProject(summary) ? 'closed' : null]
        .filter((part) => part !== null)
        .join(' · ');
    return (
        <button className={ROW} onClick={() => void openProject(row.endpointId, summary.projectId)}>
            <ProjectGlyph projectId={summary.projectId} endpointId={row.endpointId} icon={summary.icon} color={summary.color} size={16} />
            <span className="flex min-w-0 grow flex-col">
                <span className={clsx('truncate text-sm', row.connected ? 'text-text' : 'text-text-muted')}>{summary.name}</span>
                <span className="truncate text-xs text-text-faint">{where}</span>
            </span>
        </button>
    );
}

/* The project the cold start could not open, on top of Recent with why, one click from trying again. */
function FailedRow({ failure, row }: { failure: BootFailure; row: ProjectMenuRow | null }) {
    const machine = useEndpoints((s) => s.endpoints.find((endpoint) => endpoint.id === failure.endpointId)?.label ?? 'Another machine');
    return (
        <div className="flex min-h-10 w-full min-w-0 items-center gap-3 rounded-md px-2 py-1.5">
            {row ? (
                <ProjectGlyph projectId={row.summary.projectId} endpointId={row.endpointId} icon={row.summary.icon} color={row.summary.color} size={16} />
            ) : (
                <span className="size-4 shrink-0 rounded-sm bg-text-faint" />
            )}
            <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-sm text-text">{row?.summary.name ?? 'The last project'}</span>
                <span className="truncate text-xs text-status-error">
                    {machine} · {failure.reason}
                </span>
            </span>
            <Button size="sm" variant="secondary" onClick={() => void openProject(failure.endpointId, failure.projectId)}>
                <Icon icon={RotateCw} size={12} /> Try again
            </Button>
        </div>
    );
}

/* Signing in, as a card with the buttons of every provider: one click would have to guess which. */
function SignInCard({ description }: { description: string }) {
    const notice = usePulsarAccount((s) => s.notice);
    const error = usePulsarAccount((s) => s.error);
    return (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3">
            <span className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-sunken text-text-muted">
                    <Icon icon={LogIn} size={16} />
                </span>
                <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium text-text">Sign in</span>
                    <span className={clsx('text-xs', error ? 'text-status-error' : 'text-text-muted')}>{notice ?? error ?? description}</span>
                </span>
            </span>
            <SignInButtons />
        </div>
    );
}

const FOOTER_BUTTON = 'flex items-center gap-1.5 rounded-sm hover:text-text';

/* The keys that work from here, and which Ruimte this is. It stays at the bottom, and what scrolls under it fades out. */
function Footer() {
    const currentVersion = useUpdates((s) => s.currentVersion);
    const version = isDesktop() && currentVersion ? currentVersion : null;
    return (
        <footer className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-linear-to-t from-bg from-40% to-transparent px-8 pt-10 pb-4 text-xs text-text-faint *:pointer-events-auto">
            <button className={FOOTER_BUTTON} onClick={() => runAppShortcut('palette')}>
                <Kbd shortcut={APP_SHORTCUTS.palette} className={TOOLTIP_KBD} /> Command palette
            </button>
            <button className={FOOTER_BUTTON} onClick={() => runAppShortcut('settings')}>
                <Kbd shortcut={APP_SHORTCUTS.settings} className={TOOLTIP_KBD} /> Settings
            </button>
            {version && <span>Version {version}</span>}
            {version && canShowReleaseNotes() && (
                <button className={FOOTER_BUTTON} onClick={() => openReleaseNotes(version)}>
                    What's new
                </button>
            )}
        </footer>
    );
}

function StartContent() {
    const endpoints = useEndpoints((s) => s.endpoints);
    const activeId = useEndpoints((s) => s.activeId);
    const rows = useProjectList((s) => s.projects);
    const connected = useOpenEndpoints();
    const accountStatus = usePulsarAccount((s) => s.status);
    const accountMachines = usePulsarMachines((s) => s.machines);
    const failure = useWindow((s) => s.bootFailure);
    const [dialog, setDialog] = useState<'new' | 'add' | 'link' | null>(null);

    const station = !hasLocalMachine();
    const boot = stationBoot({ station, accountStatus, machines: accountMachines });
    const recent = useMemo(() => recentProjects(rows, endpoints, connected), [rows, endpoints, connected]);
    const machines = useMemo(
        () => mergeMachines({ endpoints, accountMachines: accountStatus === 'signed-in' ? accountMachines : null, showLocal: hasLocalMachine() }),
        [endpoints, accountMachines, accountStatus]
    );
    const failedRow =
        failure === null ? null : (recent.find((row) => row.endpointId === failure.endpointId && row.summary.projectId === failure.projectId) ?? null);
    /* The row that failed is already on top with its reason, and one nobody can open is left out. */
    const listed = openableRows(failedRow === null ? recent : recent.filter((row) => row !== failedRow));

    // The web client waits for the account: without it there is no machine to open anything on.
    const waiting = boot !== null && boot !== 'machines';
    const newOn = isRealMachine(activeId) ? activeId : null;
    // On the desktop signing in is one way in among the others, offered only while it can be done.
    const offerSignIn = boot === null && accountStatus === 'signed-out';
    // A fresh desktop install: nothing to go back to and only this machine, so there is one thing to do.
    const firstStart = boot === null && listed.length === 0 && failure === null && machines.length <= 1;

    const openFolder = (): void => useUi.getState().openFolderBrowser();

    const machineList = (
        <Section label="Machines">
            {machines.length === 0 ? (
                <p className="px-2 text-xs text-text-muted">
                    No machine is on your account yet. Sign in to the desktop app on a machine that runs with a broker, and it joins your account on its own.
                </p>
            ) : (
                <div className="flex flex-col gap-px">
                    {machines.map((entry) => (
                        <MachineRow key={entry.id} entry={entry} />
                    ))}
                </div>
            )}
        </Section>
    );

    return (
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-12 px-8 pt-10 pb-24">
            <BrandIntro />

            {firstStart ? (
                <div className="mx-auto flex w-full max-w-md grow flex-col gap-3">
                    <Tile
                        icon={<Icon icon={FolderOpen} size={16} />}
                        title="Open folder"
                        description="The folder of something you work on"
                        primary
                        className="py-5"
                        onClick={openFolder}
                    />
                    <p className="px-1 pb-2 text-center text-xs text-text-muted">
                        A project is a folder with a .ruimte/project.json in it, which Ruimte writes the first time the folder opens.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                        <Tile
                            icon={<Icon icon={Plus} size={16} />}
                            title="New project"
                            description="Without a folder"
                            disabled={newOn === null}
                            onClick={() => setDialog('new')}
                        />
                        <Tile
                            icon={<Icon icon={MonitorSmartphone} size={16} />}
                            title="Connect machine"
                            description="With a link"
                            onClick={() => setDialog('add')}
                        />
                    </div>
                    {offerSignIn && <SignInCard description="Reach the machines on your account." />}
                </div>
            ) : (
                <div className="grid grow grid-cols-1 items-start gap-10 md:grid-cols-2">
                    <div className="flex min-w-0 flex-col gap-8">
                        {boot === 'machines' && machineList}
                        <Section label="Start">
                            <div className="flex flex-col gap-2">
                                {boot === 'sign-in' && <SignInCard description="Sign in to open the machines on your account from this browser." />}
                                {(boot === 'loading' || boot === 'signing-in') && (
                                    <Tile
                                        icon={<Icon icon={LogIn} size={16} />}
                                        title={boot === 'signing-in' ? 'Signing in...' : 'Looking up your machines...'}
                                        description="Everything else waits for your machines"
                                        disabled
                                    />
                                )}
                                <Tile
                                    icon={<Icon icon={FolderOpen} size={16} />}
                                    title="Open folder"
                                    description="On a machine"
                                    primary={!waiting}
                                    disabled={waiting}
                                    onClick={openFolder}
                                />
                                <Tile
                                    icon={<Icon icon={Plus} size={16} />}
                                    title="New project"
                                    description={newOn === null ? 'Open a machine first' : 'Without a folder'}
                                    disabled={waiting || newOn === null}
                                    onClick={() => setDialog('new')}
                                />
                                <Tile
                                    icon={<Icon icon={MonitorSmartphone} size={16} />}
                                    title="Connect machine"
                                    description="With a pairing link"
                                    disabled={waiting}
                                    onClick={() => setDialog('add')}
                                />
                                {offerSignIn && <SignInCard description="Reach the machines on your account." />}
                            </div>
                        </Section>
                        {boot === null && machineList}
                    </div>
                    <div className="flex min-w-0 flex-col gap-8">
                        {(failure !== null || listed.length > 0) && (
                            <Section label="Recent">
                                <div className="flex flex-col gap-px">
                                    {failure !== null && <FailedRow failure={failure} row={failedRow} />}
                                    {listed.map((row) => (
                                        <RecentRow key={`${row.endpointId}:${row.summary.projectId}`} row={row} />
                                    ))}
                                </div>
                            </Section>
                        )}
                    </div>
                </div>
            )}

            <ProjectNameDialog
                open={dialog === 'new'}
                onOpenChange={(open) => setDialog(open ? 'new' : null)}
                title="New project"
                description="Stored in the app, not in a folder. To share a project through git, open a folder instead."
                action="Create"
                fallback="Untitled project"
                onSubmit={async (name) => {
                    if (newOn !== null) {
                        await createProjectOn(newOn, name);
                    }
                }}
            />
            <AddMachineDialog
                nested={false}
                open={dialog === 'add'}
                onOpenChange={(open) => setDialog(open ? 'add' : null)}
                onLinkWithCode={() => setDialog('link')}
            />
            <LinkMachineDialog open={dialog === 'link'} initialCode={null} onOpenChange={(open) => setDialog(open ? 'link' : null)} />
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
            <div className="relative min-h-0 grow">
                <div className="h-full overflow-auto">
                    <ErrorBoundary label="The start screen failed to render">
                        <StartContent />
                    </ErrorBoundary>
                </div>
                <Footer />
            </div>
        </div>
    );
}
