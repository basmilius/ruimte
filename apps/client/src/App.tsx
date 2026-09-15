import { useEffect, useState } from 'react';
import { WebviewParking } from '@/browser/WebviewParking';
import { useCanvasShortcuts } from '@/canvas/canvas-shortcuts';
import { desktop } from '@/desktop/bridge';
import { useAppShortcuts } from '@/shell/app-shortcuts';
import { CommandPalette } from '@/shell/CommandPalette';
import { LayoutDialog } from '@/shell/LayoutDialog';
import { ViewDialogs } from '@/shell/ViewDialogs';
import { FileToolbarSlotProvider } from '@/shell/panels/file-toolbar-slot';
import { ViewHost } from '@/shell/ViewHost';
import { WorktreeDialog } from '@/shell/WorktreeDialog';
import { SettingsDialog } from '@/shell/SettingsDialog';
import { ALL_SETTINGS_SECTIONS } from '@/shell/settings/sections';
import { Panel } from '@/shell/Panel';
import { PreviewPanel } from '@/shell/PreviewPanel';
import { ProjectBanner } from '@/shell/ProjectBanner';
import { MachineUpdateDialog } from '@/shell/MachineUpdateDialog';
import { ReleaseNotesDialog } from '@/shell/ReleaseNotesDialog';
import { Sidebar } from '@/shell/Sidebar';
import { Toasts } from '@/shell/Toasts';
import { Toolbar } from '@/shell/Toolbar';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useUi, type SettingsSectionId } from '@/state/ui';
import { startUpdates } from '@/state/updates';
import { focusWorkspace, useMainWorkspace, useWorkspaceConnection } from '@/transport/connections';
import { WorkspaceProvider } from '@/transport/context';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { TooltipProvider } from '@/ui/Tooltip';

/*
 * The project on screen, with the daemon it lives on under it. Everything inside reads its machine
 * from here instead of from "the active endpoint", which is what a second project next to it needs.
 */
function Workspace() {
    const workspace = useMainWorkspace();
    const connection = useWorkspaceConnection(workspace);
    /* Once for the whole project rather than once per cell: a grid draws up to nine canvases. */
    useCanvasShortcuts(workspace.stores);
    /* The window's toolbar is where a file view puts its controls, and the body that draws them sits
       under the same column, so the element they portal into is held here. */
    const [fileToolbarHost, setFileToolbarHost] = useState<HTMLElement | null>(null);
    return (
        <WorkspaceProvider connection={connection} stores={workspace.stores}>
            {/* A press anywhere in it makes this the workspace everything outside React means: the
                shortcuts, the palette and the menus all act on the project that was touched last. */}
            <div className="flex h-full w-full bg-bg" onPointerDownCapture={() => focusWorkspace(workspace.id)}>
                <ErrorBoundary label="The sidebar failed to render" className="h-full w-[248px] shrink-0 border-r border-border">
                    <Sidebar />
                </ErrorBoundary>
                <main className="flex min-w-0 grow">
                    <FileToolbarSlotProvider value={{ host: fileToolbarHost, mount: setFileToolbarHost }}>
                        <div className="flex min-w-0 grow flex-col">
                            <Toolbar />
                            <div className="relative min-h-0 grow">
                                <ViewHost />
                                <WebviewParking />
                                <ProjectBanner />
                            </div>
                        </div>
                    </FileToolbarSlotProvider>
                    <PreviewPanel />
                    <Panel />
                </main>
            </div>
            {/* About the project that is open, so they belong to its workspace and not to the shell. */}
            <LayoutDialog />
            <ViewDialogs />
            <WorktreeDialog />
        </WorkspaceProvider>
    );
}

export function App() {
    const name = useProject((s) => s.current?.name ?? null);
    useAppShortcuts();

    // The Electron window has no title of its own, so this names it as well.
    useEffect(() => {
        document.title = name ? `${name} - Ruimte` : 'Ruimte';
    }, [name]);

    // Once, with the preference as it stands: the shell reads it again from About.
    useEffect(() => startUpdates(useSettings.getState().updatesAutoDownload) ?? undefined, []);

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
            <ErrorBoundary label="Something went wrong" className="fixed inset-0 bg-bg" reload>
                <Workspace />
                <CommandPalette />
                <SettingsDialog />
                <Toasts />
                <ReleaseNotesDialog />
                <MachineUpdateDialog />
            </ErrorBoundary>
        </TooltipProvider>
    );
}
