import { useEffect, useState } from 'react';
import i18next from 'i18next';
import { WebviewParking } from '@/browser/WebviewParking';
import { EndChildrenDialog } from '@/agents/EndChildrenDialog';
import { useCanvasShortcuts } from '@/canvas/canvas-shortcuts';
import { CellOverlayLayer } from '@/shell/CellOverlay';
import { ForkDialog } from '@/shell/ForkDialog';
import { LayoutDialog } from '@/shell/LayoutDialog';
import { LeaveConflictDialog } from '@/shell/LeaveConflictDialog';
import { MachineLostScreen } from '@/shell/MachineLostScreen';
import { MergeWorktreeDialog } from '@/shell/MergeWorktreeDialog';
import { Panel } from '@/shell/Panel';
import { FileToolbarSlotProvider } from '@/shell/panels/file-toolbar-slot';
import { UnsavedCloseDialog } from '@/shell/panels/UnsavedCloseDialog';
import { PlanPanel } from '@/shell/PlanPanel';
import { ProjectBanner } from '@/shell/ProjectBanner';
import { ProjectSwitchScreen } from '@/shell/ProjectSwitchScreen';
import { RemoveWorktreeDialog } from '@/shell/RemoveWorktreeDialog';
import { Sidebar } from '@/shell/Sidebar';
import { FLOATING_FAILURE, failed } from '@/shell/surface-failure';
import { Toolbar } from '@/shell/Toolbar';
import { ViewDialogs } from '@/shell/ViewDialogs';
import { ViewHost } from '@/shell/ViewHost';
import { WorktreeDialog } from '@/shell/WorktreeDialog';
import { useUi } from '@/state/ui';
import type { Workspace } from '@/transport/connections';
import { ConnectionProvider } from '@/transport/ConnectionProvider';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { lazyDialog } from '@/ui/lazy';
import { stopVoice } from '@/voice/controller';
import { VoiceOverlay } from '@/voice/VoiceOverlay';
import { VoicePanel } from '@/voice/VoicePanel';

const ConflictOverlay = lazyDialog(
    () => import('@/conflicts/ConflictOverlay'),
    'ConflictOverlay',
    useUi,
    (s) => s.conflicts !== null
);

/*
 * The project on screen, with the daemon it lives on under it. Everything inside reads its machine
 * from here instead of from "the active endpoint", which a switch moves before the project follows.
 */
export function WorkspaceShell({ workspace }: { workspace: Workspace }) {
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
                                <ErrorBoundary label={failed('pages')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                                    <WebviewParking />
                                </ErrorBoundary>
                                {/* The chrome of a cell, over the pages a cell cannot draw over itself. */}
                                <ErrorBoundary label={failed('cellChrome')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                                    <CellOverlayLayer />
                                </ErrorBoundary>
                                {/* After the parked pages, which carry no z-index of their own and would otherwise draw over these screens. */}
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
