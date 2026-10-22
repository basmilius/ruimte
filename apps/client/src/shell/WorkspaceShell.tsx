import { useEffect, useState } from 'react';
import { refreshPrRepos } from '@/state/pr-repos';
import { shownFolderOf, useProject } from '@/state/project';
import i18next from 'i18next';
import { useStore } from 'zustand';
import { WebviewParking } from '@/browser/WebviewParking';
import { EndChildrenDialog } from '@/agents/EndChildrenDialog';
import { ChatChooserMenu } from '@/chat/ChatChooserMenu';
import { imageSaveDialog, type ImageSaveDialogState } from '@/chat/image-save';
import { WORKSPACE_CHAT_HOST } from '@/chat/workspace-host';
import { ensureDatabaseConnections } from '@/database/connections';
import { useDatabasePanel } from '@/database/state';
import { useCanvasShortcuts } from '@/canvas/canvas-shortcuts';
import { CellOverlayLayer } from '@/shell/CellOverlay';
import { startLaunchWatch } from '@/launches/watch';
import { useLaunches } from '@/launches/state';
import { ForkDialog } from '@/shell/ForkDialog';
import { LayoutDialog } from '@/shell/LayoutDialog';
import { LeaveConflictDialog } from '@/shell/LeaveConflictDialog';
import { MachineLostScreen } from '@/shell/MachineLostScreen';
import { useMachineLost } from '@/shell/use-machine-lost';
import { MergeWorktreeDialog } from '@/shell/MergeWorktreeDialog';
import { Panel } from '@/shell/Panel';
import { DiscardEditsDialog } from '@/shell/panels/DiscardEditsDialog';
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
import { useFileChoice } from '@/shell/panels/file-links';
import { ViewHost } from '@/shell/ViewHost';
import { WorktreeDialog } from '@/shell/WorktreeDialog';
import { useSettings } from '@/state/settings';
import { useVoice } from '@/voice/state';
import { useShownPanel, useUi } from '@/state/ui';
import { useDevices } from '@/devices/state';
import { startBytesWorker } from '@/transport/bytes-worker-host';
import type { Workspace } from '@/transport/connections';
import { ConnectionProvider } from '@/transport/ConnectionProvider';
import { useRemoteHolds } from '@/transport/remote-holds';
import { ErrorBoundary, Workspace as CoreWorkspace, lazyDialog, prefetcher } from '@adecore/ui';
import { ChatHostProvider } from '@adecore/agents-react';
import { stopVoice } from '@/voice/controller';
import { VoiceOverlay } from '@/voice/VoiceOverlay';
import { VoicePanel } from '@/voice/VoicePanel';

startBytesWorker();
startLaunchWatch();

const LaunchDialogs = lazyDialog(
    () => import('@/launches/LaunchDialogs'),
    'LaunchDialogs',
    useLaunches,
    (s) => s.dialog !== null
);

const DatabaseConnectionsDialog = lazyDialog(
    () => import('@/database/ConnectionsDialog'),
    'DatabaseConnectionsDialog',
    useDatabasePanel,
    (s) => s.dialog.open
);

const ImageSaveHost = lazyDialog(
    () => import('@/chat/ImageSaveHost'),
    'ImageSaveHost',
    (select: (state: ImageSaveDialogState) => boolean) => useStore(imageSaveDialog, select),
    (s) => s.session !== null
);

const NewWorktreeChatDialog = lazyDialog(
    () => import('@/shell/NewWorktreeChatDialog'),
    'NewWorktreeChatDialog',
    useUi,
    (s) => s.newWorktreeChatOpen
);

const IssueStartDialog = lazyDialog(
    () => import('@/shell/IssueStartDialog'),
    'IssueStartDialog',
    useUi,
    (s) => s.issueStartOpen
);

const PullRequestDialog = lazyDialog(
    () => import('@/shell/PullRequestDialog'),
    'PullRequestDialog',
    useUi,
    (s) => s.pullRequestDialog !== null
);

const FileChoiceDialog = lazyDialog(
    () => import('@/shell/FileChoiceDialog'),
    'FileChoiceDialog',
    useFileChoice,
    (s) => s.choice !== null
);

const RemoteNodeDialog = lazyDialog(
    () => import('@/shell/RemoteNodeDialog'),
    'RemoteNodeDialog',
    useUi,
    (s) => s.remoteNodeDialog !== null
);

const AddToMachineDialog = lazyDialog(
    () => import('@/shell/AddToMachineDialog'),
    'AddToMachineDialog',
    useUi,
    (s) => s.addToMachineDialog !== null
);

const MoveChatDialog = lazyDialog(
    () => import('@/project/MoveChatDialog'),
    'MoveChatDialog',
    useUi,
    (s) => s.moveChatDialog !== null
);

const EraseDeviceDialog = lazyDialog(
    () => import('@/devices/EraseDeviceDialog'),
    'EraseDeviceDialog',
    useDevices,
    (s) => s.erasing !== null
);

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
    useRemoteHolds(workspace.connection.endpointId);
    /* The window's toolbar is where a file view puts its controls, and the body that draws them sits
       under the same column, so the element they portal into is held here. */
    const [fileToolbarHost, setFileToolbarHost] = useState<HTMLElement | null>(null);
    const layout = useSettings((state) => state.panelLayout);
    const sidebarOpen = useUi((state) => state.sidebarOpen);
    const planOpen = useUi((state) => state.planOpen);
    const panelOpen = useShownPanel().open;
    const voiceOpen = useVoice((state) => state.open);
    const lost = useMachineLost();

    useEffect(() => {
        void prefetcher.prefetchEverything();
    }, []);
    useEffect(() => () => stopVoice(), []);
    const folder = useProject((state) => shownFolderOf(state.current));
    useEffect(() => {
        void refreshPrRepos();
    }, [folder]);
    /* The project's agents open its databases with the passwords this window holds, so they are read with the project rather than with the panel. */
    useEffect(() => {
        ensureDatabaseConnections();
    }, []);
    return (
        <ChatHostProvider host={WORKSPACE_CHAT_HOST}>
            <ConnectionProvider connection={workspace.connection}>
                <FileToolbarSlotProvider value={{ host: fileToolbarHost, mount: setFileToolbarHost }}>
                    <CoreWorkspace
                        // Under the lost screen nothing may be reached by a key either, since it would act on a machine that is gone.
                        render={<main inert={lost} />}
                        className="workspace"
                        layout={layout}
                        sidebarWidth="auto"
                        sidebarOpen={sidebarOpen}
                        sidebar={
                            <ErrorBoundary label={i18next.t('common:state.sidebarFailed')} className="h-full w-[248px] shrink-0 border-r border-border">
                                <Sidebar />
                            </ErrorBoundary>
                        }
                        toolbar={
                            <ErrorBoundary label={failed('toolbar')} resetKeys={[workspace]} compact className="shrink-0">
                                <Toolbar />
                            </ErrorBoundary>
                        }
                        sidePanelWidth="auto"
                        sidePanelOpen={planOpen || panelOpen || voiceOpen}
                        sidePanel={
                            <>
                                <PlanPanel />
                                <Panel />
                                <ErrorBoundary label={failed('voice')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                                    <VoicePanel />
                                </ErrorBoundary>
                            </>
                        }
                    >
                        <ViewHost />
                        <ErrorBoundary label={failed('pages')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                            <WebviewParking />
                        </ErrorBoundary>
                        {/* The chrome of a cell, over the pages a cell cannot draw over itself. */}
                        <ErrorBoundary label={failed('cellChrome')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                            <CellOverlayLayer />
                        </ErrorBoundary>
                        {/* After the parked pages, which carry no z-index of their own and would otherwise draw over this screen. */}
                        <ErrorBoundary label={failed('projectSwitch')} resetKeys={[workspace]} className="absolute inset-0 z-10">
                            <ProjectSwitchScreen />
                        </ErrorBoundary>
                        <ErrorBoundary label={failed('projectBanner')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                            <ProjectBanner />
                        </ErrorBoundary>
                    </CoreWorkspace>
                </FileToolbarSlotProvider>
                <ErrorBoundary label={failed('machine')} resetKeys={[workspace]} className="fixed inset-0 z-40">
                    <MachineLostScreen />
                </ErrorBoundary>
                <VoiceOverlay />
                {/* About the project that is open, so they belong to its workspace and not to the shell. */}
                <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                    <LayoutDialog />
                </ErrorBoundary>
                <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                    <ChatChooserMenu />
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
                    <DiscardEditsDialog />
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
                <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                    <LaunchDialogs />
                </ErrorBoundary>
                <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                    <DatabaseConnectionsDialog />
                </ErrorBoundary>
                <ForkDialog />
                <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                    <MoveChatDialog />
                </ErrorBoundary>
                <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                    <RemoteNodeDialog />
                    <AddToMachineDialog />
                    <EraseDeviceDialog />
                </ErrorBoundary>
                <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                    <NewWorktreeChatDialog />
                </ErrorBoundary>
                <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                    <IssueStartDialog />
                </ErrorBoundary>
                <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                    <PullRequestDialog />
                </ErrorBoundary>
                <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                    <FileChoiceDialog />
                </ErrorBoundary>
                <ErrorBoundary label={failed('dialog')} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                    <ImageSaveHost />
                </ErrorBoundary>
            </ConnectionProvider>
        </ChatHostProvider>
    );
}
