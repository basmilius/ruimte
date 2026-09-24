import i18next from 'i18next';
import { useEffect, useState } from 'react';
import { WebviewParking } from '@/browser/WebviewParking';
import { ConflictOverlay } from '@/conflicts/ConflictOverlay';
import { CellOverlayLayer } from '@/shell/CellOverlay';
import { useCanvasShortcuts } from '@/canvas/canvas-shortcuts';
import { desktop } from '@/desktop/bridge';
import { useAppShortcuts } from '@/shell/app-shortcuts';
import { CommandPalette } from '@/shell/CommandPalette';
import { LayoutDialog } from '@/shell/LayoutDialog';
import { ViewDialogs } from '@/shell/ViewDialogs';
import { EndChildrenDialog } from '@/agents/EndChildrenDialog';
import { UnsavedCloseDialog } from '@/shell/panels/UnsavedCloseDialog';
import { LeaveConflictDialog } from '@/shell/LeaveConflictDialog';
import { FileToolbarSlotProvider } from '@/shell/panels/file-toolbar-slot';
import { ViewHost } from '@/shell/ViewHost';
import { ForkDialog } from '@/shell/ForkDialog';
import { MergeWorktreeDialog } from '@/shell/MergeWorktreeDialog';
import { RemoveWorktreeDialog } from '@/shell/RemoveWorktreeDialog';
import { WorktreeDialog } from '@/shell/WorktreeDialog';
import { SettingsDialog } from '@/shell/SettingsDialog';
import { UsageDialog } from '@/shell/usage/UsageDialog';
import { ModelsDialog } from '@/shell/models/ModelsDialog';
import { ALL_SETTINGS_SECTIONS } from '@/shell/settings/sections';
import { Panel } from '@/shell/Panel';
import { PlanPanel } from '@/shell/PlanPanel';
import { ProjectBanner } from '@/shell/ProjectBanner';
import { MachineLostScreen } from '@/shell/MachineLostScreen';
import { ProjectSwitchScreen } from '@/shell/ProjectSwitchScreen';
import { StartScreen } from '@/shell/StartScreen';
import { MachineUpdateDialog } from '@/shell/MachineUpdateDialog';
import { LinkMachineDialog } from '@/shell/LinkMachineDialog';
import { closeLinkRequest, useLinkRequest } from '@/pulsar/link-request';
import { ReleaseNotesDialog } from '@/shell/ReleaseNotesDialog';
import { useNativeMenu } from '@/shell/menu/native-menu';
import { Sidebar } from '@/shell/Sidebar';
import { Toasts } from '@/shell/Toasts';
import { Toolbar } from '@/shell/Toolbar';
import { watchDrags } from '@/shell/view-drag';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useUi, type SettingsSectionId } from '@/state/ui';
import { startUpdates } from '@/state/updates';
import { useWindow } from '@/state/window';
import type { Workspace } from '@/transport/connections';
import { ConnectionProvider } from '@/transport/context';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { ShortcutHints } from '@/ui/ShortcutHints';
import { TooltipProvider } from '@/ui/Tooltip';
import { VoiceOverlay } from '@/voice/VoiceOverlay';
import { VoicePanel } from '@/voice/VoicePanel';
import { stopVoice } from '@/voice/controller';

/* Where a surface that floats on its own says it failed: a card, so the rest of the window stays usable. */
const FLOATING_FAILURE = 'fixed inset-x-0 bottom-4 z-(--z-dialog) mx-auto w-fit rounded-lg border border-border shadow-float';

const failed = (surface: string): string => i18next.t(`common:state.failed.${surface}`);

/*
 * The project on screen, with the daemon it lives on under it. Everything inside reads its machine
 * from here instead of from "the active endpoint", which a switch moves before the project follows.
 */
function WorkspaceShell({ workspace }: { workspace: Workspace }) {
    /* Once for the whole project rather than once per cell, since a grid draws up to nine canvases. */
    useCanvasShortcuts();
    /* The window's toolbar is where a file view puts its controls, and the body that draws them sits
       under the same column, so the element they portal into is held here. */
    const [fileToolbarHost, setFileToolbarHost] = useState<HTMLElement | null>(null);
    useEffect(() => () => stopVoice(), []);
    return (
        <ConnectionProvider connection={workspace.connection}>
            <div className="flex h-full w-full bg-bg">
                <ErrorBoundary label={i18next.t('common:state.sidebarFailed')} className="h-full w-[248px] shrink-0 border-r border-border">
                    <Sidebar />
                </ErrorBoundary>
                <main className="flex min-w-0 grow">
                    <FileToolbarSlotProvider value={{ host: fileToolbarHost, mount: setFileToolbarHost }}>
                        <div className="flex min-w-0 grow flex-col">
                            <ErrorBoundary label={failed('toolbar')} resetKeys={[workspace]} compact className="shrink-0 border-b border-border">
                                <Toolbar />
                            </ErrorBoundary>
                            <div className="relative min-h-0 grow">
                                <ViewHost />
                                <WebviewParking />
                                {/* The chrome of a cell, over the pages a cell cannot draw over itself. */}
                                <ErrorBoundary label={failed('cellChrome')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                                    <CellOverlayLayer />
                                </ErrorBoundary>
                                {/* After the parked pages, which carry no z-index of their own and would otherwise draw over it. */}
                                <ErrorBoundary label={failed('machine')} resetKeys={[workspace]} className="absolute inset-0 z-10">
                                    <MachineLostScreen />
                                </ErrorBoundary>
                                <ErrorBoundary label={failed('projectSwitch')} resetKeys={[workspace]} className="absolute inset-0 z-10">
                                    <ProjectSwitchScreen />
                                </ErrorBoundary>
                                <ErrorBoundary label={failed('projectBanner')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                                    <ProjectBanner />
                                </ErrorBoundary>
                            </div>
                        </div>
                    </FileToolbarSlotProvider>
                    <PlanPanel />
                    <Panel />
                    <ErrorBoundary label={failed('voice')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                        <VoicePanel />
                    </ErrorBoundary>
                </main>
            </div>
            <VoiceOverlay />
            {/* About the project that is open, so they belong to its workspace and not to the shell. */}
            <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                <LayoutDialog />
            </ErrorBoundary>
            <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                <ViewDialogs />
            </ErrorBoundary>
            <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                <EndChildrenDialog />
            </ErrorBoundary>
            <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                <UnsavedCloseDialog />
            </ErrorBoundary>
            <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                <LeaveConflictDialog />
            </ErrorBoundary>
            <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                <WorktreeDialog />
            </ErrorBoundary>
            <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                <RemoveWorktreeDialog />
            </ErrorBoundary>
            <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                <MergeWorktreeDialog />
            </ErrorBoundary>
            <ErrorBoundary label={failed('conflicts')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                <ConflictOverlay />
            </ErrorBoundary>
            <ForkDialog />
        </ConnectionProvider>
    );
}

/* The start screen, or the blank frame before it while a cold start is still trying the last project. */
function WindowContent() {
    const content = useWindow((s) => s.content);
    const booting = useWindow((s) => s.booting);
    if (content.kind === 'workspace') {
        return <WorkspaceShell workspace={content.workspace} />;
    }
    return (
        <div className="relative h-full w-full bg-bg">
            {!booting && <StartScreen />}
            <ProjectSwitchScreen />
        </div>
    );
}

/* The approval a `/link` address opened, outside every workspace. The web client shows it before a machine is picked. */
function LinkRequestDialog() {
    const open = useLinkRequest((s) => s.open);
    const code = useLinkRequest((s) => s.code);
    return <LinkMachineDialog open={open} initialCode={code} onOpenChange={(next) => (next ? undefined : closeLinkRequest())} />;
}

export function App() {
    const name = useProject((s) => s.current?.name ?? null);
    useAppShortcuts();
    useNativeMenu();

    // The Electron window has no title of its own, so this names it as well.
    useEffect(() => {
        document.title = name ? `${name} - Ruimte` : 'Ruimte';
    }, [name]);

    // Once, with the preference as it stands. The shell reads it again from About.
    useEffect(() => startUpdates(useSettings.getState().updatesAutoDownload) ?? undefined, []);

    /* Every embedded page steps aside for as long as any drag lasts, so a drop target is wherever
       it looks like it is and never behind a page that swallowed the drag. */
    useEffect(() => watchDrags(), []);

    // The macOS application menu names a pane, and switches to it when the dialog is already open.
    useEffect(
        () =>
            desktop()?.onOpenSettings?.((section) => {
                const known = ALL_SETTINGS_SECTIONS.some((entry) => entry.id === section);
                useUi.getState().setSettings(known ? { open: true, section: section as SettingsSectionId } : { open: true });
            }),
        []
    );

    return (
        <TooltipProvider>
            {/* The last resort, for a failure outside every view, node and panel. It unmounts the
                parked browser pages as well, which is why everything below carries a boundary of its own. */}
            <ErrorBoundary label={i18next.t('common:state.error')} className="fixed inset-0 bg-bg" reload>
                <WindowContent />
                <ErrorBoundary label={failed('palette')} compact className={FLOATING_FAILURE}>
                    <CommandPalette />
                </ErrorBoundary>
                <ErrorBoundary label={failed('settings')} compact className={FLOATING_FAILURE}>
                    <SettingsDialog />
                </ErrorBoundary>
                <UsageDialog />
                <ModelsDialog />
                <ErrorBoundary label={failed('toasts')} compact className={FLOATING_FAILURE}>
                    <Toasts />
                </ErrorBoundary>
                <ReleaseNotesDialog />
                <ErrorBoundary label={failed('machineUpdate')} compact className={FLOATING_FAILURE}>
                    <MachineUpdateDialog />
                </ErrorBoundary>
                <ErrorBoundary label={failed('link')} compact className={FLOATING_FAILURE}>
                    <LinkRequestDialog />
                </ErrorBoundary>
                <ErrorBoundary label={failed('shortcutHints')} compact className={FLOATING_FAILURE}>
                    <ShortcutHints />
                </ErrorBoundary>
            </ErrorBoundary>
        </TooltipProvider>
    );
}
