import { useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { isRecentProject } from '@ruimte/contracts';
import { Copy, ExternalLink, FolderOpen, LogIn, MonitorSmartphone, RotateCw } from 'lucide-react';
import { isDesktop } from '@/desktop/bridge';
import { useTrafficLightInset } from '@/desktop/useFullscreen';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { openableRows, recentProjects, type ProjectMenuRow } from '@/project/list';
import { openProject } from '@/project/open';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { usePulsarAccount } from '@/pulsar/account';
import { usePulsarMachines } from '@/pulsar/machines';
import { LinkMachineDialog } from '@/shell/LinkMachineDialog';
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
import { fileManagerName, useServers } from '@/state/server';
import { transportFor } from '@/transport';
import { hasLocalMachine } from '@/state/local-machine';
import { useProjectList } from '@/state/project-list';
import { canShowReleaseNotes, openReleaseNotes } from '@/state/release-notes';
import { useUi } from '@/state/ui';
import { useUpdates } from '@/state/updates';
import { useWindow, type BootFailure } from '@/state/window';
import { useEndpointConnection, useOpenEndpoints } from '@/transport/status';
import { BrandIntro } from '@/ui/Brand';
import { Button } from '@/ui/Button';
import { MENU_SEPARATOR, SECTION_LABEL } from '@/ui/classes';
import { copyText } from '@/ui/clipboard';
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
    /* No menu of its own: browsing its folders is the only thing this row does. */
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
    const { t } = useTranslation('shell');
    const { summary } = row;
    const where = [row.machineLabel, row.connected ? null : t('start.notConnected'), isRecentProject(summary) ? t('start.closed') : null]
        .filter((part) => part !== null)
        .join(' · ');
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger render={<button />} className={ROW} onClick={() => void openProject(row.endpointId, summary.projectId)}>
                <ProjectGlyph projectId={summary.projectId} endpointId={row.endpointId} icon={summary.icon} color={summary.color} size={16} />
                <span className="flex min-w-0 grow flex-col">
                    <span className={clsx('truncate text-sm', row.connected ? 'text-text' : 'text-text-muted')}>{summary.name}</span>
                    <span className="truncate text-xs text-text-faint">{where}</span>
                </span>
            </ContextMenu.Trigger>
            <RecentRowMenu row={row} />
        </ContextMenu.Root>
    );
}

/*
 * What a recent project offers beside opening it. Its settings live behind the project itself, so
 * this list stays with the folder: reveal it on its machine, or take the path along.
 */
function RecentRowMenu({ row }: { row: ProjectMenuRow }) {
    const { t } = useTranslation('shell');
    const { summary } = row;
    const platform = useServers((s) => s.byEndpoint[row.endpointId]?.platform ?? null);
    const folder = summary.folder ?? null;
    const reveal = (): void => {
        if (folder === null) {
            return;
        }
        void transportFor(row.endpointId)
            ?.request('fs.reveal', { path: folder })
            .catch(() => undefined);
    };
    return (
        <ContextMenu.Portal>
            <ContextMenu.Positioner className="z-(--z-popup)">
                <ContextMenu.Popup className="menu-popup">
                    <ContextMenu.Item className="menu-item" onClick={() => void openProject(row.endpointId, summary.projectId)}>
                        <Icon icon={FolderOpen} size={14} /> {t('common:action.open')}
                    </ContextMenu.Item>
                    {folder !== null && (
                        <>
                            <ContextMenu.Separator className={MENU_SEPARATOR} />
                            <ContextMenu.Item className="menu-item" disabled={!row.connected} onClick={reveal}>
                                <Icon icon={ExternalLink} size={14} /> {t('projectMenu.openIn', { app: fileManagerName(platform) })}
                            </ContextMenu.Item>
                            <ContextMenu.Item className="menu-item" onClick={() => copyText(folder)}>
                                <Icon icon={Copy} size={14} /> {t('start.copyFolder')}
                            </ContextMenu.Item>
                        </>
                    )}
                </ContextMenu.Popup>
            </ContextMenu.Positioner>
        </ContextMenu.Portal>
    );
}

/* The project the cold start could not open, on top of Recent with why, one click from trying again. */
function FailedRow({ failure, row }: { failure: BootFailure; row: ProjectMenuRow | null }) {
    const { t } = useTranslation(['shell', 'common']);
    const machine = useEndpoints((s) => s.endpoints.find((endpoint) => endpoint.id === failure.endpointId)?.label ?? t('start.anotherMachine'));
    return (
        <div className="flex min-h-10 w-full min-w-0 items-center gap-3 rounded-md px-2 py-1.5">
            {row ? (
                <ProjectGlyph projectId={row.summary.projectId} endpointId={row.endpointId} icon={row.summary.icon} color={row.summary.color} size={16} />
            ) : (
                <span className="size-4 shrink-0 rounded-sm bg-text-faint" />
            )}
            <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-sm text-text">{row?.summary.name ?? t('start.lastProject')}</span>
                <span className="truncate text-xs text-status-error">
                    {machine} · {failure.reason}
                </span>
            </span>
            <Button size="sm" variant="secondary" onClick={() => void openProject(failure.endpointId, failure.projectId)}>
                <Icon icon={RotateCw} size={12} /> {t('common:action.retry')}
            </Button>
        </div>
    );
}

/* Signing in, as a card with the buttons of every provider: one click would have to guess which. */
function SignInCard({ description }: { description: string }) {
    const { t } = useTranslation('shell');
    const notice = usePulsarAccount((s) => s.notice);
    const error = usePulsarAccount((s) => s.error);
    return (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3">
            <span className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-sunken text-text-muted">
                    <Icon icon={LogIn} size={16} />
                </span>
                <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium text-text">{t('start.signIn')}</span>
                    <span className={clsx('text-xs', error ? 'text-status-error' : 'text-text-muted')}>{notice ?? error ?? description}</span>
                </span>
            </span>
            <SignInButtons />
        </div>
    );
}

const FOOTER_BUTTON = 'flex items-center gap-1.5 rounded-sm hover:text-text';

/* The keys that work from here, and which Ruimte this is. */
function Footer() {
    const { t } = useTranslation('shell');
    const currentVersion = useUpdates((s) => s.currentVersion);
    const version = isDesktop() && currentVersion ? currentVersion : null;
    return (
        <footer className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-linear-to-t from-bg from-40% to-transparent px-8 pt-10 pb-4 text-xs text-text-faint *:pointer-events-auto">
            <button className={FOOTER_BUTTON} onClick={() => runAppShortcut('palette')}>
                <Kbd shortcut={APP_SHORTCUTS.palette} variant="inline" /> {t('start.commandPalette')}
            </button>
            <button className={FOOTER_BUTTON} onClick={() => runAppShortcut('settings')}>
                <Kbd shortcut={APP_SHORTCUTS.settings} variant="inline" /> {t('settingsDialog.title')}
            </button>
            {version && <span>{t('connection.version', { version })}</span>}
            {version && canShowReleaseNotes() && (
                <button className={FOOTER_BUTTON} onClick={() => openReleaseNotes(version)}>
                    {t('start.whatsNew')}
                </button>
            )}
        </footer>
    );
}

function StartContent() {
    const { t } = useTranslation('shell');
    const endpoints = useEndpoints((s) => s.endpoints);
    const rows = useProjectList((s) => s.projects);
    const connected = useOpenEndpoints();
    const accountStatus = usePulsarAccount((s) => s.status);
    const accountMachines = usePulsarMachines((s) => s.machines);
    const failure = useWindow((s) => s.bootFailure);
    const [dialog, setDialog] = useState<'add' | 'link' | null>(null);

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
    // On the desktop signing in is one way in among the others, offered only while it can be done.
    const offerSignIn = boot === null && accountStatus === 'signed-out';
    // A fresh desktop install: nothing to go back to and only this machine, so there is one thing to do.
    const firstStart = boot === null && listed.length === 0 && failure === null && machines.length <= 1;

    // Nothing to go back to leaves the second column empty, and a lone column belongs in the middle.
    const hasRecent = failure !== null || listed.length > 0;

    const openFolder = (): void => useUi.getState().openFolderBrowser();

    const machineList = (
        <Section label={t('start.machines')}>
            {machines.length === 0 ? (
                <p className="px-2 text-xs text-text-muted">{t('start.noMachines')}</p>
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
                        title={t('projectMenu.openFolder')}
                        description={t('start.openFolderFirst')}
                        primary
                        className="py-5"
                        onClick={openFolder}
                    />
                    <p className="px-1 pb-2 text-center text-xs text-text-muted">{t('start.projectIsAFolder')}</p>
                    <div className="grid gap-2">
                        <Tile
                            icon={<Icon icon={MonitorSmartphone} size={16} />}
                            title={t('start.connectMachine')}
                            description={t('start.withALink')}
                            onClick={() => setDialog('add')}
                        />
                    </div>
                    {offerSignIn && <SignInCard description={t('start.reachMachines')} />}
                </div>
            ) : (
                <div className={clsx('grid grow grid-cols-1 items-start gap-10', hasRecent ? 'md:grid-cols-2' : 'mx-auto w-full max-w-md')}>
                    <div className="flex min-w-0 flex-col gap-8">
                        {boot === 'machines' && machineList}
                        <Section label={t('start.start')}>
                            <div className="flex flex-col gap-2">
                                {boot === 'sign-in' && <SignInCard description={t('start.signInForMachines')} />}
                                {(boot === 'loading' || boot === 'signing-in') && (
                                    <Tile
                                        icon={<Icon icon={LogIn} size={16} />}
                                        title={boot === 'signing-in' ? t('linkMachine.signingIn') : t('start.lookingUpMachines')}
                                        description={t('start.waitsForMachines')}
                                        disabled
                                    />
                                )}
                                <Tile
                                    icon={<Icon icon={FolderOpen} size={16} />}
                                    title={t('projectMenu.openFolder')}
                                    description={t('start.onAMachine')}
                                    primary={!waiting}
                                    disabled={waiting}
                                    onClick={openFolder}
                                />
                                <Tile
                                    icon={<Icon icon={MonitorSmartphone} size={16} />}
                                    title={t('start.connectMachine')}
                                    description={t('start.withPairingLink')}
                                    disabled={waiting}
                                    onClick={() => setDialog('add')}
                                />
                                {offerSignIn && <SignInCard description={t('start.reachMachines')} />}
                            </div>
                        </Section>
                        {boot === null && machineList}
                    </div>
                    {hasRecent && (
                        <div className="flex min-w-0 flex-col gap-8">
                            <Section label={t('start.recent')}>
                                <div className="flex flex-col gap-px">
                                    {failure !== null && <FailedRow failure={failure} row={failedRow} />}
                                    {listed.map((row) => (
                                        <RecentRow key={`${row.endpointId}:${row.summary.projectId}`} row={row} />
                                    ))}
                                </div>
                            </Section>
                        </div>
                    )}
                </div>
            )}

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
    const { t } = useTranslation('shell');
    const inset = useTrafficLightInset();
    return (
        <div className="flex h-full w-full flex-col bg-bg">
            <div className="app-drag h-12 shrink-0" style={{ paddingLeft: inset ?? STRIP_PADDING_PX }} />
            <div className="relative min-h-0 grow">
                <div className="h-full overflow-auto">
                    <ErrorBoundary label={t('start.failed')}>
                        <StartContent />
                    </ErrorBoundary>
                </div>
                <Footer />
            </div>
        </div>
    );
}
