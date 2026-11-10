import { ChatHostProvider } from '@adecore/agents-react';
import { ErrorBoundary, Workspace as CoreWorkspace, prefetcher } from '@adecore/ui';
import i18next from 'i18next';
import { useEffect, useState } from 'react';
import { WebviewParking } from '@/browser/WebviewParking';
import { WORKSPACE_CHAT_HOST } from '@/chat/workspace-host';
import { hasLogoMenu } from '@/desktop/bridge';
import { SlotRow } from '@/extensions/SlotSurfaces';
import { useServerPrompts } from '@/language/use-server-prompts';
import { MachineLostScreen } from '@/machine-ui/MachineLostScreen';
import { useMachineLost } from '@/machine-ui/use-machine-lost';
import { PlanPanel } from '@/plan/PlanPanel';
import { ProjectBanner } from '@/project/ProjectBanner';
import { ProjectSwitchScreen } from '@/project/ProjectSwitchScreen';
import { workspaceDialogs } from '@/registry/dialogs';
import { workspaceEffects } from '@/registry/workspace-effects';
import { useCanvasShortcuts } from '@/shell/canvas-shortcuts';
import { StationMenu } from '@/shell/menu/StationMenu';
import { Panel } from '@/shell/Panel';
import { ShellRail } from '@/shell/ShellRail';
import { TopRow } from '@/shell/TopRow';
import { ViewHost } from '@/shell/ViewHost';
import { Sidebar } from '@/sidebar/Sidebar';
import { shownFolderOf, useProject } from '@/state/project';
import { setProjectAccent, useSettings } from '@/state/settings';
import { useShownPanel, useUi } from '@/state/ui';
import { IS_STATION } from '@/station';
import { CellOverlayLayer } from '@/surface/CellOverlay';
import { FileToolbarSlotProvider } from '@/surface/panels/file-toolbar-slot';
import { FLOATING_FAILURE, failed } from '@/surface/surface-failure';
import { workspaceShown } from '@/telemetry/workspace-load';
import { startBytesWorker } from '@/transport/bytes-worker-host';
import { useRemoteHolds } from '@/transport/remote-holds';
import { VoiceOverlay } from '@/voice/VoiceOverlay';
import { ConnectionProvider } from '@/workspace/ConnectionProvider';
import type { Workspace } from '@/workspace/connections';

startBytesWorker();

/*
 * The project on screen, with the daemon it lives on under it. Everything inside reads its machine
 * from here instead of from "the active endpoint", which a switch moves before the project follows.
 */
export function WorkspaceShell({ workspace }: { workspace: Workspace }) {
    /* Once for the whole project rather than once per cell, since a grid draws up to nine canvases. */
    useCanvasShortcuts();
    const dialogs = workspaceDialogs.useAll();
    useRemoteHolds(workspace.connection.endpointId);
    useServerPrompts(workspace.connection.transport);
    /* The window's toolbar is where a file view puts its controls, and the body that draws them sits
       under the same column, so the element they portal into is held here. */
    const [fileToolbarHost, setFileToolbarHost] = useState<HTMLElement | null>(null);
    const layout = useSettings((state) => state.panelLayout);
    const sidebarOpen = useUi((state) => state.sidebarOpen);
    const planOpen = useUi((state) => state.planOpen);
    const panelOpen = useShownPanel().open;
    const lost = useMachineLost();

    useEffect(() => {
        void prefetcher.prefetchEverything();
    }, []);
    // Per workspace, since a switch to another project keeps this shell mounted.
    useEffect(() => {
        workspaceShown();
    }, [workspace]);
    const effects = workspaceEffects.useAll();
    useEffect(() => {
        const stops = effects.map((effect) => effect.mounted?.());

        return () => {
            for (const stop of stops) {
                stop?.();
            }
        };
    }, [effects]);
    const folder = useProject((state) => shownFolderOf(state.current));
    useEffect(() => {
        for (const effect of effects) {
            effect.folderChanged?.(folder);
        }
    }, [effects, folder]);
    /* The accent follows the project on screen while the setting is on. The start screen has no workspace, so it keeps the chosen accent without asking. */
    const projectColor = useProject((state) => state.current?.color ?? null);
    useEffect(() => {
        setProjectAccent(projectColor);
    }, [projectColor]);
    useEffect(() => () => setProjectAccent(null), []);
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
                                <Sidebar brandMenu={IS_STATION || hasLogoMenu() ? <StationMenu variant="wordmark" /> : undefined} />
                            </ErrorBoundary>
                        }
                        toolbar={
                            <ErrorBoundary label={failed('toolbar')} resetKeys={[workspace]} compact className="shrink-0">
                                <TopRow />
                            </ErrorBoundary>
                        }
                        rail={
                            <ErrorBoundary label={failed('toolbar')} resetKeys={[workspace]} compact className="w-12 shrink-0">
                                <ShellRail />
                            </ErrorBoundary>
                        }
                        sidePanelWidth="auto"
                        sidePanelOpen={planOpen || panelOpen}
                        sidePanel={
                            <>
                                <PlanPanel />
                                <Panel />
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
                            <SlotRow
                                place="projectBanner"
                                context={{}}
                                words
                                wrap={(row) => <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">{row}</div>}
                            />
                        </ErrorBoundary>
                    </CoreWorkspace>
                </FileToolbarSlotProvider>
                <ErrorBoundary label={failed('machine')} resetKeys={[workspace]} className="fixed inset-0 z-40">
                    <MachineLostScreen />
                </ErrorBoundary>
                <VoiceOverlay />
                {/* About the project that is open, so they belong to its workspace and not to the shell. */}
                {dialogs.map((dialog) =>
                    dialog.surface === null ? (
                        <dialog.component key={dialog.id} />
                    ) : (
                        <ErrorBoundary key={dialog.id} label={failed(dialog.surface)} resetKeys={[workspace]} compact className={FLOATING_FAILURE}>
                            <dialog.component />
                        </ErrorBoundary>
                    )
                )}
            </ConnectionProvider>
        </ChatHostProvider>
    );
}
