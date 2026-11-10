import { ErrorBoundary, lazyNamed, LazyBoundary, WorkspaceTopRow, useWindowControlsInset } from '@adecore/ui';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { STRIP_PADDING_PX, hasLogoMenu, hasOverlayControls } from '@/desktop/bridge';
import { ProjectMenu } from '@/project/ProjectMenu';
import { StationMenu } from '@/shell/menu/StationMenu';
import { useSidebarWidth } from '@/sidebar/sidebar-width';
import { SidebarGlow } from '@/sidebar/SidebarGlow';
import { SidebarToggle } from '@/sidebar/SidebarToggle';
import { useDiagram } from '@/state/diagram';
import { useDrawing } from '@/state/drawing';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useShownPanel, useUi } from '@/state/ui';
import { IS_STATION } from '@/station';

const ProjectTabs = lazyNamed(() => import('@/shell/ProjectTabs'), 'ProjectTabs');

/*
 * The band above the work: the project, and beside it the bar of a lone cell, which the cell draws in
 * the row's slot. Its tools went to the rail, so nothing else stands here.
 */
export function TopRow() {
    const { t } = useTranslation('shell');
    const projectDirty = useProject((s) => s.dirty);
    const drawingDirty = useDrawing((s) => s.dirty);
    const diagramDirty = useDiagram((s) => s.dirty);
    const dirty = projectDirty || drawingDirty || diagramDirty;
    const switching = useProject((s) => s.switching);
    const panelOpen = useShownPanel().open;
    const sidebarOpen = useUi((s) => s.sidebarOpen);
    const tabs = useSettings((s) => s.projectNavigation === 'tabs');
    const inset = useWindowControlsInset();
    const sidebarWidth = useSidebarWidth();

    return (
        <WorkspaceTopRow
            // `app-drag` for the client's own rules about what in a drag region still answers the pointer.
            className={clsx(
                'workspace-toolbar app-drag transition-[padding] duration-200 ease-out',
                // The window controls of Linux stand over the top right while no panel header takes them.
                !panelOpen && hasOverlayControls() && 'toolbar-overlay-inset'
            )}
            style={sidebarOpen ? undefined : { paddingLeft: inset ?? STRIP_PADDING_PX }}
            // Project tabs take the row, and the view keeps a bar of its own under it.
            slotless={tabs}
            leading={
                !sidebarOpen && (
                    <>
                        <div
                            data-toolbar-glow=""
                            className="pointer-events-none absolute inset-y-0 left-0 isolate overflow-hidden"
                            style={{ width: sidebarWidth }}
                        >
                            <SidebarGlow />
                        </div>
                        {(IS_STATION || hasLogoMenu()) && <StationMenu variant="symbol" />}
                        <SidebarToggle />
                    </>
                )
            }
        >
            {tabs ? (
                <ErrorBoundary label={t('projectTabs.failed')} resetKeys={[tabs]} className="flex min-w-0 grow">
                    <LazyBoundary fallback={<div className="grow" />}>
                        <ProjectTabs dirty={dirty} />
                    </LazyBoundary>
                </ErrorBoundary>
            ) : (
                <ProjectMenu />
            )}
            {/* Out of the row while there is no dot, so its gap does not push the separator away from the project. With
                tabs the dot sits on the tab in front, and this region only speaks. */}
            <span role="status" aria-live="polite" className={dirty && !tabs ? 'flex shrink-0 items-center' : 'absolute'}>
                {dirty && !tabs && <span className="h-1.5 w-1.5 rounded-full bg-text-faint" />}
                <span className="sr-only">{dirty ? t('toolbar.unsaved') : t('toolbar.saved')}</span>
            </span>
            {switching && <div className="progress-line absolute inset-x-0 bottom-0" role="progressbar" aria-label={t('toolbar.opening')} />}
        </WorkspaceTopRow>
    );
}
