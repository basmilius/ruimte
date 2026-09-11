import { useEffect } from 'react';
import { WebviewParking } from '@/browser/WebviewParking';
import { CommandPalette } from '@/shell/CommandPalette';
import { LayoutDialog } from '@/shell/LayoutDialog';
import { ViewDialogs } from '@/shell/ViewDialogs';
import { ViewHost } from '@/shell/ViewHost';
import { WorktreeDialog } from '@/shell/WorktreeDialog';
import { Dock } from '@/shell/Dock';
import { SettingsDialog } from '@/shell/SettingsDialog';
import { Panel } from '@/shell/Panel';
import { PreviewPanel } from '@/shell/PreviewPanel';
import { ProjectBanner } from '@/shell/ProjectBanner';
import { Sidebar } from '@/shell/Sidebar';
import { Toasts } from '@/shell/Toasts';
import { Toolbar } from '@/shell/Toolbar';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { startUpdates } from '@/state/updates';
import { useMainWorkspace, useWorkspaceConnection } from '@/transport/connections';
import { WorkspaceProvider } from '@/transport/context';
import { TooltipProvider } from '@/ui/Tooltip';

/*
 * The project on screen, with the daemon it lives on under it. Everything inside reads its machine
 * from here instead of from "the active endpoint", which is what a second project next to it needs.
 */
function Workspace() {
    const workspace = useMainWorkspace();
    const connection = useWorkspaceConnection(workspace);
    return (
        <WorkspaceProvider connection={connection} stores={workspace.stores}>
            <div className="flex h-full w-full bg-bg">
                <Sidebar />
                <main className="flex min-w-0 grow">
                    <div className="flex min-w-0 grow flex-col">
                        <Toolbar />
                        <div className="relative min-h-0 grow">
                            <ViewHost />
                            <WebviewParking />
                            <ProjectBanner />
                            <Dock />
                        </div>
                    </div>
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

    // The Electron window has no title of its own, so this names it as well.
    useEffect(() => {
        document.title = name ? `${name} - Ruimte` : 'Ruimte';
    }, [name]);

    // Once, with the preference as it stands: the shell reads it again from the Updates pane.
    useEffect(() => startUpdates(useSettings.getState().updatesAutoDownload) ?? undefined, []);

    return (
        <TooltipProvider>
            <Workspace />
            <CommandPalette />
            <SettingsDialog />
            <Toasts />
        </TooltipProvider>
    );
}
