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
import { FileToolbarSlotProvider } from '@/shell/panels/file-toolbar-slot';
import { ViewHost } from '@/shell/ViewHost';
import { ForkDialog } from '@/shell/ForkDialog';
import { MergeWorktreeDialog } from '@/shell/MergeWorktreeDialog';
import { RemoveWorktreeDialog } from '@/shell/RemoveWorktreeDialog';
import { WorktreeDialog } from '@/shell/WorktreeDialog';
import { SettingsDialog } from '@/shell/SettingsDialog';
import { UsageDialog } from '@/shell/usage/UsageDialog';
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
import { TooltipProvider } from '@/ui/Tooltip';
import { VoiceOverlay } from '@/voice/VoiceOverlay';
import { VoicePanel } from '@/voice/VoicePanel';
import { stopVoice } from '@/voice/controller';

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
                            <Toolbar />
                            <div className="relative min-h-0 grow">
                                <ViewHost />
                                <WebviewParking />
                                {/* The chrome of a cell, over the pages a cell cannot draw over itself. */}
                                <CellOverlayLayer />
                                {/* After the parked pages, which carry no z-index of their own and would otherwise draw over it. */}
                                <MachineLostScreen />
                                <ProjectSwitchScreen />
                                <ProjectBanner />
                            </div>
                        </div>
                    </FileToolbarSlotProvider>
                    <PlanPanel />
                    <Panel />
                    <VoicePanel />
                </main>
            </div>
            <VoiceOverlay />
            {/* About the project that is open, so they belong to its workspace and not to the shell. */}
            <LayoutDialog />
            <ViewDialogs />
            <EndChildrenDialog />
            <UnsavedCloseDialog />
            <WorktreeDialog />
            <RemoveWorktreeDialog />
            <MergeWorktreeDialog />
            <ConflictOverlay />
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
                <CommandPalette />
                <SettingsDialog />
                <UsageDialog />
                <Toasts />
                <ReleaseNotesDialog />
                <MachineUpdateDialog />
                <LinkRequestDialog />
            </ErrorBoundary>
        </TooltipProvider>
    );
}
